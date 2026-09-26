// Per-tab static-rule breakdown, sourced from declarativeNetRequest's own
// match feedback rather than anything we infer ourselves -- real numbers,
// not estimates. getMatchedRules() is quota-limited (Chrome caps calls per
// interval; see MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL), so this is only
// refreshed once per navigation (see refreshBreakdown's caller in index.ts),
// not per request. Chrome-only: Firefox's declarativeNetRequest feedback
// support lags, so getMatchedRules may simply not exist there -- the catch
// below just leaves the breakdown at zero in that case.
import browser from "webextension-polyfill";
import {
  countedMatches,
  summarizeMatchedRules,
  summarizeMatchesByGroup,
  type Breakdown,
  type UncountedRules,
} from "../shared/matchedRuleCategories";
import { summarizeCompanies, type RuleCompanies } from "../shared/matchedRuleCompanies";
import { securityMatches } from "../shared/securityRuleCategories";
import { clearTabFromMaps } from "./tabMapCleanup";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import { getManagedPolicy } from "./managedPolicy";
import { isAthenaConfigured, queueSecurityEvent } from "./athenaIntegration";
import { resolveSecurityRuleDomain } from "./securityRuleDomain";
import { NOTHING_RECORDED, unrecorded, type Recorded } from "../shared/statsDelta";

export type { Breakdown };

const EMPTY: Breakdown = { ads: 0, trackers: 0, popups: 0 };
const EMPTY_COMPANIES: Record<string, number> = {};
const EMPTY_GROUPS: Record<string, number> = {};

let companiesCache: RuleCompanies | null = null;

async function loadCompanies(): Promise<RuleCompanies> {
  if (companiesCache) return companiesCache;
  const url = browser.runtime.getURL("rules/rule-companies.json");
  companiesCache = (await (await fetch(url)).json()) as RuleCompanies;
  return companiesCache;
}

let uncountedCache: UncountedRules | null = null;

async function loadUncounted(): Promise<UncountedRules> {
  if (uncountedCache) return uncountedCache;
  const url = browser.runtime.getURL("rules/uncounted-rules.json");
  uncountedCache = (await (await fetch(url)).json()) as UncountedRules;
  return uncountedCache;
}

// The single reference in the whole codebase to this Chrome-only DNR
// feedback global (Firefox doesn't implement it) -- kept in one function
// body, not at module scope, so it tree-shakes cleanly out of bundles that
// don't use it (the options page) and `web-ext lint` only ever flags this
// one line. The guard below and background/index.ts's company-breakdown
// handler both go through this rather than reaching for `chrome.` again.
// getMatchedRules allows 20 calls per 10 minutes outside a user gesture.
// Remember when calls were made, so optional reads (the late refresh) can
// leave room for the ones a person is waiting on (opening the popup).
const QUOTA_WINDOW_MS = 10 * 60 * 1000;
const callTimes: number[] = [];

/** getMatchedRules calls made in the last 10 minutes. */
export function recentMatchedRulesCalls(now = Date.now()): number {
  while (callTimes.length > 0 && now - callTimes[0]! > QUOTA_WINDOW_MS) callTimes.shift();
  return callTimes.length;
}

function matchedRulesApi(): typeof chrome.declarativeNetRequest.getMatchedRules | undefined {
  return chrome.declarativeNetRequest?.getMatchedRules;
}

const breakdownByTab = new Map<number, Breakdown>();
const companiesByTab = new Map<number, Record<string, number>>();
const groupsByTab = new Map<number, Record<string, number>>();
// When each tab's current page committed. getMatchedRules({ tabId }) alone
// returns the tab's matches from the last few minutes, previous pages
// included (an ad-heavy site's late requests showed up on the example.com
// that replaced it), so the refresh asks only for matches since this.
const pageStartByTab = new Map<number, number>();
// Security matches already sent to Athena for the tab's current page, so a
// second refresh of the same page doesn't send them again.
const securitySentByTab = new Map<number, Recorded>();

export function getBreakdown(tabId: number): Breakdown {
  return breakdownByTab.get(tabId) ?? EMPTY;
}

/** Optional "by company" detail for the popup's collapsed-by-default
 * disclosure -- see src/shared/matchedRuleCompanies.ts. Most blocked
 * requests have no entry (TrackerDB only covers a fraction of the bundled
 * domains), so this is additive, never a replacement for getBreakdown. */
export function getCompanyBreakdown(tabId: number): Record<string, number> {
  return companiesByTab.get(tabId) ?? EMPTY_COMPANIES;
}

/** Same match data as getBreakdown, kept per filter-list group (e.g. "ads",
 * "cookie-notices") instead of collapsed into the 3-bucket breakdown --
 * what the Settings "Filter Lists" tab's "matched n times on this page"
 * line reads. */
export function getGroupBreakdown(tabId: number): Record<string, number> {
  return groupsByTab.get(tabId) ?? EMPTY_GROUPS;
}

/** Whether declarativeNetRequest match feedback exists at all -- false on
 * Firefox, where the whole Ads/Trackers/Popups breakdown (and the company
 * detail derived from it) stays at zero. Exported so callers outside this
 * module don't each reach for the Chrome-only global themselves. */
export function isMatchedRulesSupported(): boolean {
  return Boolean(matchedRulesApi());
}

function clearTab(tabId: number): void {
  clearTabFromMaps(tabId, breakdownByTab, companiesByTab, groupsByTab, pageStartByTab, securitySentByTab);
}

/** Called when a tab's top frame commits a new page. pageStart is the
 * commit's own timestamp (webNavigation details.timeStamp). */
export function resetBreakdown(tabId: number, pageStart?: number): void {
  clearTab(tabId);
  if (pageStart !== undefined) pageStartByTab.set(tabId, pageStart);
}
export const forgetTab = clearTab;

export async function refreshBreakdown(tabId: number): Promise<Breakdown> {
  try {
    // getMatchedRules is a Chrome-only, callback/promise-hybrid DNR feedback
    // API the webextension-polyfill doesn't wrap -- undefined on Firefox,
    // where this whole path no-ops. The block is also wrapped in try/catch,
    // so a call that throws fails the same safe way.
    const getMatchedRules = matchedRulesApi();
    if (!getMatchedRules) return getBreakdown(tabId);

    const minTimeStamp = pageStartByTab.get(tabId);
    callTimes.push(Date.now());
    const [manifest, companies, uncounted, { rulesMatchedInfo }] = await Promise.all([
      loadRulesetManifest(),
      loadCompanies(),
      loadUncounted(),
      getMatchedRules(minTimeStamp === undefined ? { tabId } : { tabId, minTimeStamp }),
    ]);
    const matches = countedMatches(
      uncounted,
      rulesMatchedInfo.map((info) => ({
        rulesetId: info.rule.rulesetId,
        ruleId: info.rule.ruleId,
      }))
    );
    const breakdown = summarizeMatchedRules(manifest, matches);
    breakdownByTab.set(tabId, breakdown);
    companiesByTab.set(tabId, summarizeCompanies(companies, matches));
    groupsByTab.set(tabId, summarizeMatchesByGroup(manifest, matches));

    // Cheap on every normal install: securityMatches is pure/in-memory, and
    // only reaches for the managed policy (the one part of this that costs
    // an actual storage call) when this page's matches actually included a
    // malicious/phishing/scam/badware hit -- which is the rare case, not
    // the common one. queueSecurityEvent itself still no-ops instantly if
    // Athena isn't configured; this guard just avoids the policy read at
    // all for the vast majority of page loads that hit neither.
    const allFlagged = securityMatches(manifest, matches);
    const flagged = newSecurityMatches(tabId, allFlagged);
    if (flagged.length > 0) {
      const policy = await getManagedPolicy();
      // Domain resolution (a ruleset fetch-and-index) only runs when
      // there's actually somewhere to send it -- isAthenaConfigured is the
      // same cheap in-memory check queueSecurityEvent itself does, checked
      // again here specifically to skip the heavier lookup on every normal,
      // non-Athena install that happens to hit a security-list match.
      const athenaConfigured = isAthenaConfigured(policy);
      for (const match of flagged) {
        const domain = athenaConfigured ? await resolveSecurityRuleDomain(match.rulesetId, match.ruleId) : null;
        void queueSecurityEvent(policy, {
          category: "security-rule",
          riskTier: match.riskTier,
          rulesetId: match.rulesetId,
          ruleId: match.ruleId,
          domain: domain ?? undefined,
        });
      }
    }

    return breakdown;
  } catch {
    // Tab closed mid-call, permission not granted, or the per-interval
    // quota was hit -- keep whatever was there before.
    return getBreakdown(tabId);
  }
}

/** The flagged matches not already sent for this tab's current page. The
 * same rule can match several requests, so this counts per rule. */
function newSecurityMatches<T extends { rulesetId: string; ruleId?: number }>(tabId: number, flagged: T[]): T[] {
  if (flagged.length === 0) return flagged;
  const key = (m: T) => `${m.rulesetId}:${m.ruleId ?? ""}`;
  const counts: Record<string, number> = {};
  for (const m of flagged) counts[key(m)] = (counts[key(m)] ?? 0) + 1;
  const fresh = unrecorded(securitySentByTab.get(tabId) ?? NOTHING_RECORDED, flagged.length, counts);
  securitySentByTab.set(tabId, fresh.next);
  const remaining = { ...fresh.counts };
  return flagged.filter((m) => {
    const k = key(m);
    if (!remaining[k]) return false;
    remaining[k] -= 1;
    return true;
  });
}

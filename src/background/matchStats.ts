// Per-tab static-rule breakdown, sourced from declarativeNetRequest's own
// match feedback rather than anything we infer ourselves -- real numbers,
// not estimates. getMatchedRules() is quota-limited (Chrome caps calls per
// interval; see MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL), so this is only
// refreshed once per navigation (see refreshBreakdown's caller in index.ts),
// not per request. Chrome-only: Firefox's declarativeNetRequest feedback
// support lags, so getMatchedRules may simply not exist there -- the catch
// below just leaves the breakdown at zero in that case.
import browser from "webextension-polyfill";
import { summarizeMatchedRules, type Breakdown } from "../shared/matchedRuleCategories";
import { summarizeCompanies, type RuleCompanies } from "../shared/matchedRuleCompanies";
import { securityMatches } from "../shared/securityRuleCategories";
import { clearTabFromMaps } from "./tabMapCleanup";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import { getManagedPolicy } from "./managedPolicy";
import { queueSecurityEvent } from "./athenaIntegration";

export type { Breakdown };

const EMPTY: Breakdown = { ads: 0, trackers: 0, popups: 0 };
const EMPTY_COMPANIES: Record<string, number> = {};

let companiesCache: RuleCompanies | null = null;

async function loadCompanies(): Promise<RuleCompanies> {
  if (companiesCache) return companiesCache;
  const url = browser.runtime.getURL("rules/rule-companies.json");
  companiesCache = (await (await fetch(url)).json()) as RuleCompanies;
  return companiesCache;
}

const breakdownByTab = new Map<number, Breakdown>();
const companiesByTab = new Map<number, Record<string, number>>();

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

function clearTab(tabId: number): void {
  clearTabFromMaps(tabId, breakdownByTab, companiesByTab);
}

export const resetBreakdown = clearTab;
export const forgetTab = clearTab;

export async function refreshBreakdown(tabId: number): Promise<Breakdown> {
  try {
    // Raw chrome global rather than the browser (webextension-polyfill)
    // import used elsewhere in this file: getMatchedRules is a Chrome-only,
    // callback/promise-hybrid DNR feedback API the polyfill doesn't wrap.
    // The whole block is wrapped in try/catch below, so a missing `chrome`
    // global (shouldn't happen -- both targets expose it) fails the same
    // safe way as a missing getMatchedRules does.
    const getMatchedRules = chrome.declarativeNetRequest?.getMatchedRules;
    if (!getMatchedRules) return getBreakdown(tabId);

    const [manifest, companies, { rulesMatchedInfo }] = await Promise.all([
      loadRulesetManifest(),
      loadCompanies(),
      getMatchedRules({ tabId }),
    ]);
    const matches = rulesMatchedInfo.map((info) => ({
      rulesetId: info.rule.rulesetId,
      ruleId: info.rule.ruleId,
    }));
    const breakdown = summarizeMatchedRules(manifest, matches);
    breakdownByTab.set(tabId, breakdown);
    companiesByTab.set(tabId, summarizeCompanies(companies, matches));

    // Cheap on every normal install: securityMatches is pure/in-memory, and
    // only reaches for the managed policy (the one part of this that costs
    // an actual storage call) when this page's matches actually included a
    // malicious/phishing/scam/badware hit -- which is the rare case, not
    // the common one. queueSecurityEvent itself still no-ops instantly if
    // Athena isn't configured; this guard just avoids the policy read at
    // all for the vast majority of page loads that hit neither.
    const flagged = securityMatches(manifest, matches);
    if (flagged.length > 0) {
      const policy = await getManagedPolicy();
      for (const match of flagged) {
        void queueSecurityEvent(policy, {
          category: "security-rule",
          riskTier: match.riskTier,
          rulesetId: match.rulesetId,
          ruleId: match.ruleId,
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

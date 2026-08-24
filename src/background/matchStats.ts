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
import type { RulesetManifestEntry } from "../shared/rulesetManifest";

export type { Breakdown };

const EMPTY: Breakdown = { ads: 0, trackers: 0, popups: 0 };
const EMPTY_COMPANIES: Record<string, number> = {};

let manifestCache: RulesetManifestEntry[] | null = null;

async function loadManifest(): Promise<RulesetManifestEntry[]> {
  if (manifestCache) return manifestCache;
  const url = browser.runtime.getURL("rules/manifest.json");
  manifestCache = (await (await fetch(url)).json()) as RulesetManifestEntry[];
  return manifestCache;
}

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

export function resetBreakdown(tabId: number): void {
  breakdownByTab.delete(tabId);
  companiesByTab.delete(tabId);
}

export function forgetTab(tabId: number): void {
  breakdownByTab.delete(tabId);
  companiesByTab.delete(tabId);
}

export async function refreshBreakdown(tabId: number): Promise<Breakdown> {
  try {
    const getMatchedRules = chrome.declarativeNetRequest?.getMatchedRules;
    if (!getMatchedRules) return getBreakdown(tabId);

    const [manifest, companies, { rulesMatchedInfo }] = await Promise.all([
      loadManifest(),
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
    return breakdown;
  } catch {
    // Tab closed mid-call, permission not granted, or the per-interval
    // quota was hit -- keep whatever was there before.
    return getBreakdown(tabId);
  }
}

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
import type { RulesetManifestEntry } from "../shared/rulesetManifest";

export type { Breakdown };

const EMPTY: Breakdown = { ads: 0, trackers: 0, popups: 0 };

let manifestCache: RulesetManifestEntry[] | null = null;

async function loadManifest(): Promise<RulesetManifestEntry[]> {
  if (manifestCache) return manifestCache;
  const url = browser.runtime.getURL("rules/manifest.json");
  manifestCache = (await (await fetch(url)).json()) as RulesetManifestEntry[];
  return manifestCache;
}

const breakdownByTab = new Map<number, Breakdown>();

export function getBreakdown(tabId: number): Breakdown {
  return breakdownByTab.get(tabId) ?? EMPTY;
}

export function resetBreakdown(tabId: number): void {
  breakdownByTab.delete(tabId);
}

export function forgetTab(tabId: number): void {
  breakdownByTab.delete(tabId);
}

export async function refreshBreakdown(tabId: number): Promise<Breakdown> {
  try {
    const getMatchedRules = chrome.declarativeNetRequest?.getMatchedRules;
    if (!getMatchedRules) return getBreakdown(tabId);

    const manifest = await loadManifest();
    const { rulesMatchedInfo } = await getMatchedRules({ tabId });
    const breakdown = summarizeMatchedRules(
      manifest,
      rulesMatchedInfo.map((info) => ({ rulesetId: info.rule.rulesetId }))
    );
    breakdownByTab.set(tabId, breakdown);
    return breakdown;
  } catch {
    // Tab closed mid-call, permission not granted, or the per-interval
    // quota was hit -- keep whatever was there before.
    return getBreakdown(tabId);
  }
}

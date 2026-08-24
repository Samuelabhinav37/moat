// Diagnostic tool, not a user feature: chrome.declarativeNetRequest.onRuleMatchedDebug
// fires per-match with the actual request URL and which rule matched it --
// but per Chrome's own docs this event only exists for extensions loaded
// unpacked (developer mode), never a Chrome Web Store install. Scoped
// deliberately narrow: this exists to diagnose Moat's own fragile
// heuristics (the YouTube ad dimmer, the feed scanner) when they break
// silently after a site markup change, not to be a general end-user
// feature -- see src/logger/.
import type { LoggedMatch } from "../types";

const MAX_ENTRIES_PER_TAB = 200;
const entriesByTab = new Map<number, LoggedMatch[]>();

/** Pure ring-buffer append, pulled out so it's testable without the
 * chrome.declarativeNetRequest API this file otherwise depends on. Mutates
 * and returns `entries` for convenience at the one call site. */
export function appendEntry(entries: LoggedMatch[], entry: LoggedMatch, max: number): LoggedMatch[] {
  entries.push(entry);
  if (entries.length > max) entries.shift();
  return entries;
}

export function isSupported(): boolean {
  return typeof chrome !== "undefined" && !!chrome.declarativeNetRequest?.onRuleMatchedDebug;
}

export function getEntries(tabId: number): LoggedMatch[] {
  return entriesByTab.get(tabId) ?? [];
}

export function forgetTab(tabId: number): void {
  entriesByTab.delete(tabId);
}

export function initRuleLogger(): void {
  if (!isSupported()) return;

  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const { tabId } = info.request;
    if (tabId < 0) return; // not associated with any tab (e.g. a background fetch)

    const entries = appendEntry(
      entriesByTab.get(tabId) ?? [],
      {
        timestamp: Date.now(),
        url: info.request.url,
        method: info.request.method,
        type: info.request.type,
        ruleId: info.rule.ruleId,
        rulesetId: info.rule.rulesetId,
      },
      MAX_ENTRIES_PER_TAB
    );
    entriesByTab.set(tabId, entries);
  });
}

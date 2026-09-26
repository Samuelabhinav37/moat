// Exact per-tab count of requests the browser's blocking engine refused on
// the page shown now, as they happen. declarativeNetRequest's own match
// feedback (getMatchedRules, matchStats.ts) says *which* rule matched, which
// the ads/trackers/pop-ups split needs, but Chrome allows only 20 calls per
// 10 minutes; after heavy browsing it fails and the popup used to show 0
// (docs/research/test-audit-2026-09.md, finding 4.2). webRequest's
// onErrorOccurred has no quota: every refused request reports
// net::ERR_BLOCKED_BY_CLIENT. It can't say which list matched, so it only
// feeds the total (blockStats.ts), never the split.
import browser from "webextension-polyfill";
import { clearTabFromMaps } from "./tabMapCleanup";

const BLOCKED_BY_EXTENSION = "net::ERR_BLOCKED_BY_CLIENT";

export interface ErrorDetails {
  tabId: number;
  type: string;
  error: string;
  timeStamp: number;
}

// When each counted block happened, per tab. Times rather than a plain
// counter because the "new page" reset (webNavigation.onCommitted) can reach
// the worker after the new page's first blocks already did; resetting then
// keeps every block at or after the page's start instead of wiping them.
const blockTimesByTab = new Map<number, number[]>();
const pageStartByTab = new Map<number, number>();
// A page that blocks thousands of requests doesn't need thousands of times.
const MAX_TIMES_PER_TAB = 10000;

/** A refused sub-resource of a real tab's current page. A refused top-level
 * navigation isn't "blocked on this page" (it's a different page). */
export function isCountableBlock(details: ErrorDetails, pageStart: number | undefined): boolean {
  if (details.error !== BLOCKED_BY_EXTENSION) return false;
  if (details.tabId < 0 || details.type === "main_frame") return false;
  return pageStart === undefined || details.timeStamp >= pageStart;
}

export function getLiveCount(tabId: number): number {
  return blockTimesByTab.get(tabId)?.length ?? 0;
}

/** Called when a tab's top frame commits a new page (webNavigation timeStamp). */
export function resetLive(tabId: number, pageStart?: number): void {
  if (pageStart === undefined) {
    clearTabFromMaps(tabId, blockTimesByTab, pageStartByTab);
    return;
  }
  pageStartByTab.set(tabId, pageStart);
  const kept = (blockTimesByTab.get(tabId) ?? []).filter((time) => time >= pageStart);
  if (kept.length > 0) blockTimesByTab.set(tabId, kept);
  else blockTimesByTab.delete(tabId);
}

export function forgetLive(tabId: number): void {
  clearTabFromMaps(tabId, blockTimesByTab, pageStartByTab);
}

/** Exported for tests; the listener below is the only other caller. */
export function recordError(details: ErrorDetails, onCounted: (tabId: number) => void): void {
  if (!isCountableBlock(details, pageStartByTab.get(details.tabId))) return;
  const times = blockTimesByTab.get(details.tabId) ?? [];
  if (times.length < MAX_TIMES_PER_TAB) times.push(details.timeStamp);
  blockTimesByTab.set(details.tabId, times);
  onCounted(details.tabId);
}

// An ad script swapped for one of Moat's harmless stand-ins (AdGuard's
// $redirect rules, Moat's retry-loop stubs) never errors: Chrome reports a
// redirect to this extension's own file instead. Same count, same rules.
// The host isn't Moat's extension id: web_accessible_resources use
// use_dynamic_url (scripts/manifest.ts), so Chrome serves them from a random
// per-session id. Match the extension scheme and Moat's stand-in folder.
export function isStandInRedirect(redirectUrl: string): boolean {
  return /^(chrome|moz)-extension:\/\/[^/]+\/web-accessible-resources\/redirects\//.test(redirectUrl);
}

/** Registers the listeners. Must run at the service worker's top level so
 * the events can wake it. No-ops where webRequest isn't available. */
export function startLiveBlockCounting(onCounted: (tabId: number) => void): void {
  const webRequest = browser.webRequest;
  if (!webRequest?.onErrorOccurred) return;
  webRequest.onErrorOccurred.addListener((details) => recordError(details as unknown as ErrorDetails, onCounted), { urls: ["<all_urls>"] });
  webRequest.onBeforeRedirect?.addListener(
    (details) => {
      if (!isStandInRedirect(details.redirectUrl)) return;
      recordError({ tabId: details.tabId, type: details.type, error: BLOCKED_BY_EXTENSION, timeStamp: details.timeStamp }, onCounted);
    },
    { urls: ["<all_urls>"] }
  );
}

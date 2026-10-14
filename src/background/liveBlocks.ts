// Exact per-tab count of requests the browser's blocking engine refused on
// the page shown now, as they happen. declarativeNetRequest's own match
// feedback (getMatchedRules, matchStats.ts) says *which* rule matched, which
// the ads/trackers/pop-ups split needs, but Chrome allows only 20 calls per
// 10 minutes; after heavy browsing it fails and the popup used to show 0
// (docs/research/test-audit-2026-09.md, finding 4.2). webRequest's
// onErrorOccurred has no quota: every refused request reports
// net::ERR_BLOCKED_BY_CLIENT. It can't say which list matched, but it does
// carry the request's URL: the blocked hosts are kept per page so
// blockStats.ts can sort them by company and purpose from their domain
// (shared/trackerDomains.ts), quota-free.
//
// Each blocked address (host and path, without the query) counts once per
// page. A page retrying a blocked request counted every attempt: ChatGPT's
// own telemetry showed 1,136 "blocked" in a day (field report 2026-10-14).
import browser from "webextension-polyfill";
import { clearTabFromMaps } from "./tabMapCleanup";

const BLOCKED_BY_EXTENSION = "net::ERR_BLOCKED_BY_CLIENT";

export interface ErrorDetails {
  tabId: number;
  type: string;
  error: string;
  timeStamp: number;
  url?: string;
}

// Each distinct blocked address on the tab's page -> when it was first
// blocked. Times because the "new page" reset (webNavigation.onCommitted)
// can reach the worker after the new page's first blocks already did;
// resetting then keeps every block at or after the page's start instead of
// wiping them.
const addressesByTab = new Map<number, Map<string, number>>();
const pageStartByTab = new Map<number, number>();
// A page that blocks thousands of addresses doesn't need thousands kept.
const MAX_ADDRESSES_PER_TAB = 10000;
// The page's own host name, for telling its own analytics from a third
// party's (shared/trackerDomains.ts).
const pageHostByTab = new Map<number, string>();

/** A refused page load: which tab, which page, and when. */
export interface PageBlocked {
  tabId: number;
  url: string;
  timeStamp: number;
}

/** A whole page (top-level navigation) Moat refused to load. */
export function isBlockedPage(details: ErrorDetails): boolean {
  return details.error === BLOCKED_BY_EXTENSION && details.tabId >= 0 && details.type === "main_frame";
}

/** The address a block counts under: host and path, no query or fragment.
 * Null for a URL that can't be read. Exported for tests. */
export function blockedAddress(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/** Blocked request hosts on the tab's current page, and how many distinct
 * addresses each. */
export function getBlockedHosts(tabId: number): ReadonlyMap<string, number> {
  const hosts = new Map<string, number>();
  for (const address of addressesByTab.get(tabId)?.keys() ?? []) {
    const slash = address.indexOf("/");
    if (slash > 0) hosts.set(address.slice(0, slash), (hosts.get(address.slice(0, slash)) ?? 0) + 1);
  }
  return hosts;
}

/** The tab's page host name, as last committed or changed in place. */
export function getPageHost(tabId: number): string | undefined {
  return pageHostByTab.get(tabId);
}

/** A refused sub-resource of a real tab's current page. A refused top-level
 * navigation isn't "blocked on this page" (it's a different page). */
export function isCountableBlock(details: ErrorDetails, pageStart: number | undefined): boolean {
  if (details.error !== BLOCKED_BY_EXTENSION) return false;
  if (details.tabId < 0 || details.type === "main_frame") return false;
  return pageStart === undefined || details.timeStamp >= pageStart;
}

let liveCounting = false;

/** Whether refused requests are being counted here (webRequest is available).
 * When they are, the distinct count is the page's total. */
export function isLiveCounting(): boolean {
  return liveCounting;
}

/** Distinct addresses blocked on the tab's current page. */
export function getLiveCount(tabId: number): number {
  return addressesByTab.get(tabId)?.size ?? 0;
}

/** Called when a tab's top frame commits a new page, or a single-page app
 * moves to a new path (webNavigation timeStamp, and the new address). */
export function resetLive(tabId: number, pageStart?: number, pageUrl?: string): void {
  const host = blockedAddress(pageUrl)?.split("/")[0];
  if (host) pageHostByTab.set(tabId, host);
  else if (pageUrl !== undefined) pageHostByTab.delete(tabId);
  if (pageStart === undefined) {
    clearTabFromMaps(tabId, addressesByTab, pageStartByTab);
    return;
  }
  pageStartByTab.set(tabId, pageStart);
  const kept = new Map([...(addressesByTab.get(tabId) ?? [])].filter(([, time]) => time >= pageStart));
  if (kept.size > 0) addressesByTab.set(tabId, kept);
  else addressesByTab.delete(tabId);
}

export function forgetLive(tabId: number): void {
  clearTabFromMaps(tabId, addressesByTab, pageStartByTab, pageHostByTab);
}

/** Exported for tests; the listener below is the only other caller. */
export function recordError(details: ErrorDetails, onCounted: (tabId: number) => void, onPageBlocked?: (block: PageBlocked) => void): void {
  if (isBlockedPage(details)) {
    if (details.url) onPageBlocked?.({ tabId: details.tabId, url: details.url, timeStamp: details.timeStamp });
    return;
  }
  if (!isCountableBlock(details, pageStartByTab.get(details.tabId))) return;
  // A request without a readable address still counts, once per moment.
  const address = blockedAddress(details.url) ?? `?${details.timeStamp}`;
  const addresses = addressesByTab.get(details.tabId) ?? new Map<string, number>();
  if (addresses.has(address) || addresses.size >= MAX_ADDRESSES_PER_TAB) return;
  addresses.set(address, details.timeStamp);
  addressesByTab.set(details.tabId, addresses);
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
export function startLiveBlockCounting(onCounted: (tabId: number) => void, onPageBlocked?: (block: PageBlocked) => void): void {
  const webRequest = browser.webRequest;
  if (!webRequest?.onErrorOccurred) return;
  liveCounting = true;
  webRequest.onErrorOccurred.addListener((details) => recordError(details as unknown as ErrorDetails, onCounted, onPageBlocked), { urls: ["<all_urls>"] });
  webRequest.onBeforeRedirect?.addListener(
    (details) => {
      if (!isStandInRedirect(details.redirectUrl)) return;
      recordError({ tabId: details.tabId, type: details.type, error: BLOCKED_BY_EXTENSION, timeStamp: details.timeStamp, url: details.url }, onCounted);
    },
    { urls: ["<all_urls>"] }
  );
}

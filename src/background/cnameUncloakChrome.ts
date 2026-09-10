// Chrome-only CNAME uncloaking, opt-in and off by default (shares Settings
// -> "Uncloak disguised trackers" with the Firefox path in
// background/cnameUncloak.ts, which uses Firefox's own native
// dns.resolve() instead -- this file only runs where that isn't available,
// see isSupported() below).
//
// Chrome has neither dns.resolve() nor a blocking webRequest listener (MV3
// removed the latter for regular extensions), so this can't be a port of
// the Firefox path. Instead: observe (non-blocking) requests for the same
// "is this hostname a disguised subdomain of the page you're on" candidates
// Firefox gates on (isCandidateForUncloak), resolve via a public DoH
// endpoint, and on a confirmed cloak add a dynamic declarativeNetRequest
// block rule for that specific hostname.
//
// Two real, disclosed trade-offs against the Firefox path (see this
// setting's Chrome-specific copy in options.html):
// 1. The FIRST request to a newly-discovered cloaked hostname in a session
//    is NOT blocked -- nothing can synchronously delay a real request while
//    an async DoH lookup completes under MV3. Only requests to it after
//    that point are, once the dynamic rule is in place. Firefox's
//    synchronous blocking listener has no such gap.
// 2. Every uncached candidate hostname is sent to a third party (Cloudflare
//    DNS) for resolution -- Firefox's dns.resolve() stays inside the
//    browser's own resolver. Deliberately narrowed to the same small
//    candidate set Firefox gates on, not every hostname visited.
import browser from "webextension-polyfill";
import type { WebRequest } from "webextension-polyfill";
import { isCandidateForUncloak, isCnameCloakDestination } from "./cnameUncloakMatch";
import { safeHostname } from "./redirectDomainMatch";
import {
  buildCnameDohBlockRules,
  allCnameDohBlockRuleIds,
  parseDohCnameAnswer,
  MAX_CNAME_DOH_RULES,
  type DohResponse,
} from "./cnameUncloakDoh";
import type { Settings } from "../types";

let cloakDestinations: Set<string> | null = null;

async function loadCloakDestinations(): Promise<Set<string>> {
  if (cloakDestinations) return cloakDestinations;
  const url = browser.runtime.getURL("rules/cname-cloak-destinations.json");
  const domains = (await (await fetch(url)).json()) as string[];
  cloakDestinations = new Set(domains);
  return cloakDestinations;
}

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** Queries Cloudflare's public DoH resolver for hostname's CNAME record.
 * Fails open (returns null) on any network/parse error, the same as the
 * Firefox path's resolveCanonicalName -- a lookup failure should never
 * itself count as "confirmed safe" or "confirmed cloaked." */
async function resolveCnameViaDoh(hostname: string): Promise<string | null> {
  try {
    const response = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=CNAME`, {
      headers: { Accept: "application/dns-json" },
    });
    if (!response.ok) return null;
    return parseDohCnameAnswer((await response.json()) as DohResponse);
  } catch {
    return null;
  }
}

// Every hostname this session that's already been checked, whether it
// turned out to be a cloak or not -- prevents re-querying the DoH endpoint
// (and re-racing the dynamic-rule update below) on every subsequent request
// to the same candidate hostname. Bounded the same way cnameUncloak.ts's
// own resolution cache is: a full clear-and-restart is fine, this is a
// best-effort dedupe, not correctness-load-bearing.
const checkedThisSession = new Set<string>();
const MAX_CHECKED_ENTRIES = 2000;

// The confirmed-cloak hostnames discovered this session, oldest first --
// rebuilt into dynamic rules in full on every new discovery (small, capped
// list; see MAX_CNAME_DOH_RULES), same full-replace pattern customRules.ts
// already uses rather than an incremental diff. Kept at or under
// MAX_CNAME_DOH_RULES *before* calling buildCnameDohBlockRules (rather than
// relying on that function's own defensive cap) so the two can never
// disagree about which hostnames survive eviction.
let blockedHostnames: string[] = [];

async function blockHostnameGoingForward(hostname: string): Promise<void> {
  if (blockedHostnames.includes(hostname)) return;
  blockedHostnames.push(hostname);
  if (blockedHostnames.length > MAX_CNAME_DOH_RULES) blockedHostnames.shift();
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: allCnameDohBlockRuleIds(),
    addRules: buildCnameDohBlockRules(blockedHostnames),
  });
}

// A non-blocking listener's return type is `void`, not a Promise -- the
// browser never awaits it, unlike Firefox's blocking path in
// cnameUncloak.ts. This synchronous wrapper is what's actually registered;
// it fires the real (async) handling off and returns immediately.
function onBeforeRequest(details: WebRequest.OnBeforeRequestDetailsType): void {
  void handleBeforeRequest(details);
}

async function handleBeforeRequest(details: WebRequest.OnBeforeRequestDetailsType): Promise<void> {
  if (details.frameId === 0 || !details.documentUrl) return;

  const pageHostname = safeHostname(details.documentUrl);
  const requestHostname = safeHostname(details.url);
  if (!pageHostname || !requestHostname) return;
  if (!isCandidateForUncloak(requestHostname, pageHostname)) return;
  if (checkedThisSession.has(requestHostname)) return;

  if (checkedThisSession.size >= MAX_CHECKED_ENTRIES) checkedThisSession.clear();
  checkedThisSession.add(requestHostname);

  const [destinations, canonical] = await Promise.all([loadCloakDestinations(), resolveCnameViaDoh(requestHostname)]);
  if (canonical && isCnameCloakDestination(canonical, destinations)) {
    await blockHostnameGoingForward(requestHostname);
  }
}

let registered = false;

// Whether this worker instance has already made sure no stale dynamic
// rules are left over from a previous session (or from before this cleanup
// existed) while the feature is off. Separate from `registered` -- that
// flag is about the *listener* and starts false on every fresh
// service-worker instance regardless of whether the feature was left on or
// off, so gating cleanup on "were we just registered in THIS instance"
// would miss the far more common case: the toggle was already off (or was
// turned off in a previous, now-gone worker instance) when this instance
// starts up, and Chrome's dynamic declarativeNetRequest rules persist
// across worker restarts even though this in-memory flag doesn't.
let cleanupChecked = false;

/** True only where Firefox's better, synchronous path (cnameUncloak.ts)
 * isn't available -- both files gate the same setting, and this one must
 * never also run on Firefox alongside it. */
export function isSupported(): boolean {
  return (
    // onBeforeRequest is a chrome.events.Event *instance* (an object with
    // addListener/removeListener methods), never itself a function -- same
    // existence check cnameUncloak.ts's own isSupported() uses for this
    // exact property. `typeof ... === "function"` here would be false in
    // every real browser, Chrome included, silently disabling this entire
    // feature path everywhere.
    browser.webRequest?.onBeforeRequest !== undefined &&
    typeof browser.declarativeNetRequest?.updateDynamicRules === "function" &&
    typeof browser.dns?.resolve !== "function"
  );
}

/** Removes every dynamic rule this feature could have added and forgets
 * this session's in-memory discoveries -- called whenever the feature
 * should NOT be running, not just on the on-to-off transition, so rules
 * left over from before this cleanup existed (or from a worker restart
 * while the toggle was already off) actually get removed too. Safe to call
 * even when nothing was ever added: removeRuleIds on IDs that don't exist
 * is a no-op, not an error. */
async function clearBlockedHostnames(): Promise<void> {
  blockedHostnames = [];
  checkedThisSession.clear();
  await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: allCnameDohBlockRuleIds() });
}

/** Adds/removes the observational listener to match current settings --
 * called from settings.ts's applyEffectiveSettings() alongside the Firefox
 * path; each gates itself via its own isSupported(), so calling both here
 * is safe on every browser. */
export function applyCnameUncloakChrome(settings: Settings): void {
  if (!isSupported()) return;

  const shouldRun = settings.enabled && settings.cnameUncloaking;
  if (shouldRun) {
    if (!registered) {
      browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ["<all_urls>"] });
      registered = true;
    }
    // Re-enabling later should get a real chance to clean up again too.
    cleanupChecked = false;
  } else {
    if (registered) {
      browser.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
      registered = false;
    }
    if (!cleanupChecked) {
      cleanupChecked = true;
      void clearBlockedHostnames().catch(() => {
        // Best-effort -- retry on the next settings reapply rather than
        // leaving stale rules stuck forever over one transient failure.
        cleanupChecked = false;
      });
    }
  }
}

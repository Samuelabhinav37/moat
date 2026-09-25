// Firefox-only real CNAME uncloaking, opt-in and off by default (Settings
// -> "Uncloak disguised trackers (Firefox)"). A CNAME-cloaked tracker hides
// behind a subdomain of the site you're visiting (e.g. trk.example.com
// actually CNAMEs to some-tracker.net) specifically to defeat domain-based
// blocking -- Moat's existing 274k static rules never see the real
// destination. Chrome has no extension API for DNS resolution at all
// (confirmed: no dns.resolve() equivalent exists there), a hard platform
// gap documented in the README. Firefox does expose one, the same
// `browser.dns.resolve()` API uBlock Origin uses for the same purpose --
// this uses it for real, not a static-list approximation (a static list of
// known cloak *destinations* can't work without actually resolving the
// CNAME chain to compare against it; see the README's CNAME section for
// why that was tried and rejected first).
//
// Firefox's blocking webRequest listeners can return a Promise (documented
// since Firefox 52), so this resolves the CNAME chain per-candidate-request
// directly in the blocking listener rather than needing a separate cache-
// warming pass with a fail-open-on-first-hit compromise.
import browser from "webextension-polyfill";
import type { WebRequest } from "webextension-polyfill";
import { isCandidateForUncloak, isCnameCloakDestination, pageHostnameForRequest } from "./cnameUncloakMatch";
import { isPagePaused, loadCloakDestinations, setUncloakSettings } from "./cnameDestinations";
import { recordSignalEvent } from "./usageStats";
import { recordFired } from "./liveHeuristics";
import type { Settings } from "../types";

// Firefox's own dns.resolve() already sits in front of the OS/network DNS
// cache; this second, in-memory cache exists only to skip the extra
// message-passing round trip to the parent process for a hostname already
// resolved earlier in the same session. Only successful resolutions are
// cached -- caching a failure (below) would turn one transient DNS hiccup
// into a standing uncloak-bypass window for that hostname until the
// background context restarts, which is worse than just retrying. Capped
// so a session that touches many distinct hostnames can't grow this
// unboundedly; a full clear-and-restart is fine since this is purely a
// best-effort speed-up, not a correctness-load-bearing cache.
const canonicalNameCache = new Map<string, string | null>();
const MAX_CACHE_ENTRIES = 500;

async function resolveCanonicalName(hostname: string): Promise<string | null> {
  if (canonicalNameCache.has(hostname)) return canonicalNameCache.get(hostname) ?? null;
  try {
    const record = await browser.dns.resolve(hostname, ["canonical_name"]);
    const canonical = record.canonicalName && record.canonicalName !== hostname ? record.canonicalName : null;
    if (canonicalNameCache.size >= MAX_CACHE_ENTRIES) canonicalNameCache.clear();
    canonicalNameCache.set(hostname, canonical);
    return canonical;
  } catch {
    // Resolution failure (offline, TRR down, hostname doesn't exist) --
    // fail open, and deliberately don't cache the miss: a hostname that
    // fails once should still be retried on its next request rather than
    // being permanently treated as unresolvable for this session.
    return null;
  }
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function onBeforeRequest(details: WebRequest.OnBeforeRequestDetailsType): Promise<WebRequest.BlockingResponse> {
  // A page navigation is the page itself, not a subresource that could be a
  // disguised tracker. See pageHostnameForRequest for why this isn't a
  // frameId check.
  const pageHostname = pageHostnameForRequest(details);
  const requestHostname = safeHostname(details.url);
  if (!pageHostname || !requestHostname) return {};

  // Only resolve DNS for requests that could plausibly be a disguised
  // subdomain of the page you're on -- see cnameUncloakMatch.ts for why a
  // request to a domain that doesn't share the page's apex doesn't need
  // this at all.
  if (!isCandidateForUncloak(requestHostname, pageHostname)) return {};
  if (isPagePaused(pageHostname)) return {};

  const [destinations, canonical] = await Promise.all([loadCloakDestinations(), resolveCanonicalName(requestHostname)]);
  if (canonical && isCnameCloakDestination(canonical, destinations)) {
    void recordSignalEvent("cnameUncloak", pageHostname);
    if (details.tabId >= 0) recordFired(details.tabId, "cnameUncloak");
    return { cancel: true };
  }
  return {};
}

let registered = false;

export function isSupported(): boolean {
  return typeof browser.dns?.resolve === "function" && browser.webRequest?.onBeforeRequest !== undefined;
}

/** Adds/removes the blocking listener to match current settings -- called
 * from settings.ts's applyEffectiveSettings(), same as every other opt-in
 * toggle here. A no-op everywhere but Firefox with the `dns` permission. */
export function applyCnameUncloak(settings: Settings): void {
  if (!isSupported()) return;
  setUncloakSettings(settings);

  const shouldRun = settings.enabled && settings.cnameUncloaking;
  if (shouldRun && !registered) {
    browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ["<all_urls>"] }, ["blocking"]);
    registered = true;
  } else if (!shouldRun && registered) {
    browser.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
    registered = false;
  }
}

// The script half of tracker cookies. ruleset_tracker-cookies strips the
// cookies a cookie-blocked tracker (Privacy Badger's list, see
// scripts/lib/trackerCookieRules.mjs) sends and sets over the network;
// cookie-clobber.js, registered for those trackers' frames in
// optionalContentScripts.ts, stops their script setting them with
// document.cookie. Privacy Badger does the same.
//
// A registered script can't know the page is paused (its excludeMatches
// only see the frame's own address), so the pause is honoured here: when a
// tracker frame commits on a paused page, the guard is lifted again.
import browser from "webextension-polyfill";
import { matchesDomainOrSubdomain } from "../shared/domainChain";
import { COOKIE_GUARD_RELEASED, COOKIE_GUARD_WRITES } from "../shared/trackerCookieGuard";
import { safeHostname } from "./redirectDomainMatch";
import { isSiteDisabled } from "./settings";

export interface TrackerCookieData {
  hosts: string[];
  /** Sign-in and payment hosts under those (accounts.google.com), which keep
   * their cookies. */
  keep: string[];
  /** Company site groups that include a stripped tracker (Privacy Badger's
   * multiDomainFirstParties). Also inlined into cookie-clobber.js. */
  entities: string[][];
}

let data: Promise<TrackerCookieData | null> | null = null;

/** rules/tracker-cookie-hosts.json, read once per worker; null if missing. */
export function loadTrackerCookieData(): Promise<TrackerCookieData | null> {
  data ??= (async () => {
    try {
      const d = (await (await fetch(browser.runtime.getURL("rules/tracker-cookie-hosts.json"))).json()) as TrackerCookieData;
      return Array.isArray(d.hosts) && Array.isArray(d.keep) && Array.isArray(d.entities) ? d : null;
    } catch {
      return null;
    }
  })();
  return data;
}

/** Runs in the frame (MAIN world): marks it released, so a guard that hasn't
 * run yet skips it, and removes one that already did, saving the cookies the
 * frame wrote meanwhile. Self-contained: it's serialised into the frame. */
function releaseGuard(releasedKey: string, writesKey: string): void {
  const doc = document as unknown as Record<string | symbol, unknown>;
  doc[Symbol.for(releasedKey)] = true;
  delete doc.cookie;
  delete doc.referrer;
  const writes = doc[Symbol.for(writesKey)];
  if (Array.isArray(writes)) for (const raw of writes) document.cookie = String(raw);
}

async function onFrameCommitted(details: { tabId: number; frameId: number; url: string }): Promise<void> {
  if (details.frameId === 0 || details.tabId < 0) return;
  const frameHost = safeHostname(details.url);
  if (!frameHost) return;
  const loaded = await loadTrackerCookieData();
  if (!loaded || !matchesDomainOrSubdomain(frameHost, loaded.hosts)) return;
  const top = await browser.webNavigation.getFrame({ tabId: details.tabId, frameId: 0 }).catch(() => null);
  const pageHost = top?.url ? safeHostname(top.url) : null;
  if (!pageHost || !(await isSiteDisabled(pageHost))) return;
  await browser.scripting
    .executeScript({
      target: { tabId: details.tabId, frameIds: [details.frameId] },
      func: releaseGuard,
      args: [COOKIE_GUARD_RELEASED, COOKIE_GUARD_WRITES],
      world: "MAIN",
      injectImmediately: true,
    })
    .catch(() => {
      // The frame went away, or won't take scripts (a PDF viewer).
    });
}

/** Registers the listener. Top level of the worker, so a frame can wake it. */
export function startCookieClobber(): void {
  browser.webNavigation.onCommitted.addListener((details) => void onFrameCommitted(details));
}

// Injects the up-front cosmetic CSS as a user-origin stylesheet from the
// service worker, on webNavigation.onCommitted, instead of the content
// script building a <style> on the page thread.
//
// v0.11.63 already moved the ~1 MB dataset parse off the page thread (the
// worker owns it, see cosmeticIndex.ts). This is the follow-on: the worker
// now also *applies* the result, via scripting.insertCSS(origin:"USER"), so
// the page thread does no <style> build at all -- only the DOM surveyor runs
// there, and its matches are injected worker-side too
// (background/index.ts's get-cosmetic-generics handler).
//
// Parity, not new capability: like the old content-script <style>, this is
// injected once per top-frame navigation and gone with the document on the
// next one. Pausing a site mid-page still only takes effect on the next
// navigation (onCommitted re-checks isSiteDisabled and skips) -- exactly as
// before -- so there's no per-tab removeCSS bookkeeping.
import browser from "webextension-polyfill";
import {
  buildGrayscaleStyleText,
  buildInjectionStyleText,
  buildStyleText,
  customSelectorsForHostname,
} from "../content/cosmeticSelectors";
import { cosmeticSliceFor } from "./cosmeticIndex";
import { getEffectiveSettings, isSiteDisabled } from "./settings";
import { safeHostname } from "./redirectDomainMatch";
import { LIVE_COSMETIC_FIXES_KEY, LIVE_YOUTUBE_QUICK_FIXES_KEY } from "../types";

// live/cosmetic-fixes.json and live/youtube-quick-fixes.json, both already
// shape- and safety-validated by liveUpdates.ts on the way into
// storage.local. Default hard to {} -- an easy read to get wrong.
async function readLiveFixMap(key: string): Promise<Record<string, string[]>> {
  try {
    const stored = await browser.storage.local.get(key);
    const map = stored[key];
    return typeof map === "object" && map !== null && !Array.isArray(map)
      ? (map as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

/** Build and inject the bundled + user cosmetic CSS for a committed
 * top-frame navigation. No-ops (never throws) when protection is off/paused,
 * there's nothing to inject, or the tab/page won't accept CSS. */
export async function injectCosmeticsForCommit(tabId: number, url: string): Promise<void> {
  const hostname = safeHostname(url);
  if (!hostname) return;

  const settings = await getEffectiveSettings();
  if (!settings.enabled) return;
  if (await isSiteDisabled(hostname)) return;

  const [slice, liveFixes, liveYoutubeFixes] = await Promise.all([
    cosmeticSliceFor(hostname).catch(() => null),
    readLiveFixMap(LIVE_COSMETIC_FIXES_KEY),
    readLiveFixMap(LIVE_YOUTUBE_QUICK_FIXES_KEY),
  ]);
  if (!slice) return;

  const hideSelectors = [
    ...slice.genericHigh,
    ...slice.domainSelectors,
    ...customSelectorsForHostname(settings.customCosmeticRules, hostname),
    ...customSelectorsForHostname(liveFixes, hostname),
    ...customSelectorsForHostname(liveYoutubeFixes, hostname),
  ];
  const graySelectors = customSelectorsForHostname(settings.customGrayscaleRules, hostname);

  const css = [
    buildStyleText(hideSelectors),
    buildGrayscaleStyleText(graySelectors),
    buildInjectionStyleText(slice.injectRules),
  ]
    .filter(Boolean)
    .join("\n");
  if (!css) return;

  try {
    await browser.scripting.insertCSS({
      target: { tabId, frameIds: [0] },
      css,
      origin: "USER",
    });
  } catch {
    // Tab closed mid-navigation, or a page CSS can't be injected into
    // (chrome://, the Web Store, a PDF viewer) -- the same pages the old
    // content script couldn't run on either.
  }
}

/** Inject the surveyor's freshly-matched generic selectors into one frame,
 * user-origin. Called from the get-cosmetic-generics handler once it has
 * resolved the hashes. */
export async function injectGenericSelectors(
  tabId: number,
  frameId: number,
  selectors: string[]
): Promise<void> {
  if (selectors.length === 0) return;
  try {
    await browser.scripting.insertCSS({
      target: { tabId, frameIds: [frameId] },
      css: buildStyleText(selectors),
      origin: "USER",
    });
  } catch {
    // Same benign cases as injectCosmeticsForCommit.
  }
}

// Isolated-world content script, top frame only. Hides the leftover empty
// boxes/banners a blocked ad or cookie notice leaves behind, using the
// AdGuard cosmetic (##) rules compiled by scripts/update-cosmetics.mjs.
//
// The bundled cosmetic dataset (rules/cosmetics-meta.json ~684 KB + the
// domain-bucket shards) is fetched and parsed by the service worker
// (background/cosmeticIndex.ts) and kept in memory there. This script asks
// it, once per navigation, for the slice that applies to this hostname
// (get-cosmetic-slice) instead of parsing ~1 MB of JSON on the page thread
// at document_start.
//
// Plain CSS injected via <style> elements, not a one-time query-and-hide
// pass -- the rules stay live and keep matching elements a site adds later
// (SPA navigation, lazy-loaded ad slots) with no per-element work.
//
// The generic (no-hostname) slice is split: `genericHigh` (selectors with
// no anchoring class/id token) goes in up front on every page; the
// token-anchored generic selectors are added progressively by
// cosmeticSurveyor.ts as their tokens actually appear in the DOM (each
// resolved via a get-cosmetic-generics message), so the style engine only
// ever evaluates the generic selectors relevant to this page instead of the
// whole ~17k set.
import browser from "webextension-polyfill";
import {
  buildGrayscaleStyleText,
  buildInjectionStyleText,
  buildStyleText,
  customSelectorsForHostname,
} from "./cosmeticSelectors";
import { startSurveyor } from "./cosmeticSurveyor";
import { startAdCollapse } from "./adCollapse";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { LIVE_COSMETIC_FIXES_KEY, type CosmeticGenericsResponse, type CosmeticSliceResponse } from "../types";

async function fetchJson<T>(path: string): Promise<T> {
  return (await fetch(browser.runtime.getURL(path))).json() as Promise<T>;
}

// The curated ad-network domain list adCollapse.ts uses. Best-effort: an
// empty set just means the collapse pass no-ops.
async function readAdNetworks(): Promise<Set<string>> {
  try {
    const list = await fetchJson<unknown>("rules/ad-networks.json");
    return Array.isArray(list) ? new Set(list.filter((d): d is string => typeof d === "string")) : new Set();
  } catch {
    return new Set();
  }
}

// The live cosmetic-fix map (background/liveUpdates.ts refreshes it from
// live/cosmetic-fixes.json). Already shape- and safety-validated on the way
// in; still an easy read to get wrong, so default hard to `{}`.
async function readLiveCosmeticFixes(): Promise<Record<string, string[]>> {
  try {
    const stored = await browser.storage.local.get(LIVE_COSMETIC_FIXES_KEY);
    const map = stored[LIVE_COSMETIC_FIXES_KEY];
    return typeof map === "object" && map !== null && !Array.isArray(map)
      ? (map as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

// Ask the service worker for this hostname's bundled cosmetic slice. One
// retry, then null -- a transient miss degrades this page to only the user's
// own custom/live selectors, same visible effect as a failed fetch before.
async function requestSlice(hostname: string): Promise<CosmeticSliceResponse | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = (await browser.runtime.sendMessage({ type: "get-cosmetic-slice", hostname })) as
        | CosmeticSliceResponse
        | undefined;
      if (res) return res;
    } catch {
      // Service worker asleep or restarting -- fall through to the retry.
    }
  }
  return null;
}

async function run(): Promise<void> {
  const effective = await getEffectiveSettingsHere();
  if (isDisabled(effective)) return;

  const [slice, liveFixes, adNetworks] = await Promise.all([
    requestSlice(location.hostname),
    readLiveCosmeticFixes(),
    readAdNetworks(),
  ]);

  // Collapse the empty space a network-blocked ad iframe/img leaves behind.
  // Independent of the selector-based hiding below; runs on its own timers.
  startAdCollapse(window, adNetworks);

  const customRules = { hide: effective.customCosmeticRules, gray: effective.customGrayscaleRules };

  // Live cosmetic fixes and the user's own element-picker rules ride the same
  // domain-scoped hide path as the bundled per-domain selectors -- plain
  // data, never surveyed -- and don't depend on the service worker, so
  // they're applied even if the slice request above failed.
  const domainSelectors = [
    ...(slice?.domainSelectors ?? []),
    ...customSelectorsForHostname(customRules.hide, location.hostname),
    ...customSelectorsForHostname(liveFixes, location.hostname),
  ];
  const graySelectors = customSelectorsForHostname(customRules.gray, location.hostname);
  const injectRules = slice?.injectRules ?? [];
  const genericHigh = slice?.genericHigh ?? [];
  const hasTokenIndex = slice?.hasTokenIndex ?? false;

  if (
    domainSelectors.length === 0 &&
    graySelectors.length === 0 &&
    injectRules.length === 0 &&
    genericHigh.length === 0 &&
    !hasTokenIndex
  ) {
    return;
  }

  // Split into separate <style> blocks so the surveyor can append to the
  // generic one without touching the intentionally-scoped per-domain/custom
  // selectors. Grayscale rules live alongside the domain block since they're
  // custom-rule-sourced too.
  if (domainSelectors.length > 0 || graySelectors.length > 0) {
    const domainStyle = document.createElement("style");
    domainStyle.id = "moat-cosmetic-domain";
    domainStyle.textContent = [buildStyleText(domainSelectors), buildGrayscaleStyleText(graySelectors)]
      .filter(Boolean)
      .join("\n");
    document.documentElement.append(domainStyle);
  }

  // Own dedicated block: each injection rule carries its own declaration
  // (buildInjectionStyleText can't batch them into one shared selector
  // list), and it must stay untouched by the generic block the surveyor
  // rewrites.
  if (injectRules.length > 0) {
    const injectStyle = document.createElement("style");
    injectStyle.id = "moat-cosmetic-inject";
    injectStyle.textContent = buildInjectionStyleText(injectRules);
    document.documentElement.append(injectStyle);
  }

  if (genericHigh.length > 0 || hasTokenIndex) {
    const genericStyle = document.createElement("style");
    genericStyle.id = "moat-cosmetic-generic";
    genericStyle.textContent = buildStyleText(genericHigh);
    document.documentElement.append(genericStyle);

    if (hasTokenIndex) {
      startSurveyor(
        document,
        genericHigh,
        (hashes) =>
          browser.runtime
            .sendMessage({ type: "get-cosmetic-generics", hostname: location.hostname, hashes })
            .then((res) => (res as CosmeticGenericsResponse | undefined)?.selectors ?? []),
        (fresh) => {
          genericStyle.textContent = [genericStyle.textContent, buildStyleText(fresh)].filter(Boolean).join("\n");
        }
      );
    }
  }
}

void run();

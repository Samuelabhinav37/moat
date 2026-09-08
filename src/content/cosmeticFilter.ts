// Isolated-world content script, top frame only. Hides the leftover empty
// boxes/banners a blocked ad or cookie notice leaves behind, using the
// AdGuard cosmetic (##) rules compiled by scripts/update-cosmetics.mjs.
//
// Plain CSS injected via <style> elements, not a one-time query-and-hide
// pass -- the rules stay live and keep matching elements a site adds later
// (SPA navigation, lazy-loaded ad slots) with no per-element work.
//
// The generic (no-hostname) slice is split: `genericHigh` (selectors with
// no anchoring class/id token) goes in up front on every page; the
// token-anchored generic selectors are added progressively by
// cosmeticSurveyor.ts as their tokens actually appear in the DOM, so the
// style engine only ever evaluates the generic selectors relevant to this
// page instead of the whole ~17k set.
import browser from "webextension-polyfill";
import {
  buildGrayscaleStyleText,
  buildInjectionStyleText,
  buildStyleText,
  customSelectorsForHostname,
  domainInjectionRulesForHostname,
  domainSelectorsForHostname,
  genericInjectionRulesForHostname,
  genericSelectorsForHostname,
  mergeDomainShards,
  shardIndicesForHostname,
  splitDomainShards,
  type CosmeticManifest,
  type DomainShardEntry,
} from "./cosmeticSelectors";
import { startSurveyor } from "./cosmeticSurveyor";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { LIVE_COSMETIC_FIXES_KEY } from "../types";

interface CosmeticMeta {
  genericByHash: Record<string, string[]>;
  genericHigh: string[];
  exceptions: Record<string, string[]>;
  injectGeneric: Array<[string, string]>;
}

async function fetchJson<T>(path: string): Promise<T> {
  return (await fetch(browser.runtime.getURL(path))).json() as Promise<T>;
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

async function run(): Promise<void> {
  const effective = await getEffectiveSettingsHere();
  if (isDisabled(effective)) return;

  const manifest = await fetchJson<CosmeticManifest>("rules/cosmetics-manifest.json");
  const bucketIndices = shardIndicesForHostname(location.hostname, manifest.bucketCount);
  const [meta, liveFixes, ...shards] = await Promise.all([
    fetchJson<CosmeticMeta>(`rules/${manifest.meta}`),
    readLiveCosmeticFixes(),
    ...bucketIndices.map((i) => fetchJson<Record<string, DomainShardEntry>>(`rules/cosmetics-bucket-${i}.json`)),
  ]);

  const { perDomain, injectPerDomain } = splitDomainShards(mergeDomainShards(shards));
  const index = {
    genericByHash: meta.genericByHash,
    genericHigh: meta.genericHigh,
    exceptions: meta.exceptions,
    perDomain,
    injectGeneric: meta.injectGeneric,
    injectPerDomain,
  };
  const customRules = { hide: effective.customCosmeticRules, gray: effective.customGrayscaleRules };
  const genericSelectors = genericSelectorsForHostname(index, location.hostname);
  const hasTokenIndex = Object.keys(index.genericByHash).length > 0;
  // Live cosmetic fixes ride the same domain-scoped hide path as the user's own
  // element-picker rules -- plain data, never surveyed.
  const domainSelectors = [
    ...domainSelectorsForHostname(index, location.hostname),
    ...customSelectorsForHostname(customRules.hide, location.hostname),
    ...customSelectorsForHostname(liveFixes, location.hostname),
  ];
  const graySelectors = customSelectorsForHostname(customRules.gray, location.hostname);
  const injectRules = [
    ...genericInjectionRulesForHostname(index, location.hostname),
    ...domainInjectionRulesForHostname(index, location.hostname),
  ];
  if (
    genericSelectors.length === 0 &&
    !hasTokenIndex &&
    domainSelectors.length === 0 &&
    graySelectors.length === 0 &&
    injectRules.length === 0
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

  if (genericSelectors.length > 0 || hasTokenIndex) {
    const genericStyle = document.createElement("style");
    genericStyle.id = "moat-cosmetic-generic";
    genericStyle.textContent = buildStyleText(genericSelectors);
    document.documentElement.append(genericStyle);

    if (hasTokenIndex) {
      startSurveyor(document, index, location.hostname, genericSelectors, (fresh) => {
        genericStyle.textContent = [genericStyle.textContent, buildStyleText(fresh)].filter(Boolean).join("\n");
      });
    }
  }
}

void run();

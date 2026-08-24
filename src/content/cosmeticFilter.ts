// Isolated-world content script, top frame only. Hides the leftover empty
// boxes/banners a blocked ad or cookie notice leaves behind, using the
// AdGuard cosmetic (##) rules compiled by scripts/update-cosmetics.mjs.
//
// This is plain CSS injected once via a <style> element, not a one-time
// DOM query-and-hide pass -- the rules stay live and keep matching new
// elements a site adds later (SPA navigation, lazy-loaded ad slots) with
// no MutationObserver needed.
import browser from "webextension-polyfill";
import {
  buildGrayscaleStyleText,
  buildStyleText,
  customSelectorsForHostname,
  domainSelectorsForHostname,
  genericSelectorsForHostname,
  mergeDomainShards,
  selectorsStillMatching,
  shardIndicesForHostname,
  type CosmeticManifest,
} from "./cosmeticSelectors";
import { isDisabledHere } from "./siteDisabled";
import { STORAGE_KEY, type Settings } from "../types";

async function fetchJson<T>(path: string): Promise<T> {
  return (await fetch(browser.runtime.getURL(path))).json() as Promise<T>;
}

async function loadCustomRuleMaps(): Promise<{ hide: Record<string, string[]>; gray: Record<string, string[]> }> {
  // Direct storage read rather than importing background/settings.ts -- that
  // module also pulls in the DNR/filter-group application logic this
  // content script has no use for.
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  return { hide: settings?.customCosmeticRules ?? {}, gray: settings?.customGrayscaleRules ?? {} };
}

async function run(): Promise<void> {
  if (await isDisabledHere()) return;

  const manifest = await fetchJson<CosmeticManifest>("rules/cosmetics-manifest.json");
  const bucketIndices = shardIndicesForHostname(location.hostname, manifest.bucketCount);
  const [meta, ...shards] = await Promise.all([
    fetchJson<{ generic: string[]; exceptions: Record<string, string[]> }>(`rules/${manifest.meta}`),
    ...bucketIndices.map((i) => fetchJson<Record<string, string[]>>(`rules/cosmetics-bucket-${i}.json`)),
  ]);

  const index = { generic: meta.generic, exceptions: meta.exceptions, perDomain: mergeDomainShards(shards) };
  const customRules = await loadCustomRuleMaps();
  const genericSelectors = genericSelectorsForHostname(index, location.hostname);
  const domainSelectors = [
    ...domainSelectorsForHostname(index, location.hostname),
    ...customSelectorsForHostname(customRules.hide, location.hostname),
  ];
  const graySelectors = customSelectorsForHostname(customRules.gray, location.hostname);
  if (genericSelectors.length === 0 && domainSelectors.length === 0 && graySelectors.length === 0) return;

  // Split into two <style> blocks purely so the document_idle trim below can
  // target the generic one without touching per-domain/custom selectors,
  // which are intentionally scoped and never pruned. Grayscale rules live
  // alongside the domain block since they're custom-rule-sourced too.
  if (domainSelectors.length > 0 || graySelectors.length > 0) {
    const domainStyle = document.createElement("style");
    domainStyle.id = "moat-cosmetic-domain";
    domainStyle.textContent = [buildStyleText(domainSelectors), buildGrayscaleStyleText(graySelectors)]
      .filter(Boolean)
      .join("\n");
    document.documentElement.append(domainStyle);
  }

  if (genericSelectors.length > 0) {
    const genericStyle = document.createElement("style");
    genericStyle.id = "moat-cosmetic-generic";
    genericStyle.textContent = buildStyleText(genericSelectors);
    document.documentElement.append(genericStyle);
    window.addEventListener("load", () => trimUnmatchedGenericRules(genericStyle, genericSelectors), { once: true });
  }
}

/**
 * One-time cleanup after the page finishes its initial load: prune generic
 * selectors that matched nothing anywhere in the final DOM. Not a
 * MutationObserver -- runs once, not on every mutation -- and not a network
 * optimization -- the full generic set was already fetched and injected at
 * document_start exactly as before this existed. Purely reduces how many
 * live selectors the browser's style engine keeps evaluating on every
 * subsequent recalc, which matters most on long-lived SPA tabs (Instagram,
 * YouTube, LinkedIn). Rebuilds the style text from the known selector array
 * rather than parsing it back out of the CSSOM's rendered `selectorText` --
 * some kept selectors (native `:has(a, b)`) contain commas of their own,
 * which a naive comma-split on the serialized text would corrupt.
 */
function trimUnmatchedGenericRules(styleEl: HTMLStyleElement, genericSelectors: string[]): void {
  const stillMatching = selectorsStillMatching(document, genericSelectors);
  if (stillMatching.length === genericSelectors.length) return; // nothing to prune
  styleEl.textContent = buildStyleText(stillMatching);
}

void run();

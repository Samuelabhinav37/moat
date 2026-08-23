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
  mergeDomainShards,
  selectorsForHostname,
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
  const selectors = [
    ...selectorsForHostname(index, location.hostname),
    ...customSelectorsForHostname(customRules.hide, location.hostname),
  ];
  const graySelectors = customSelectorsForHostname(customRules.gray, location.hostname);
  if (selectors.length === 0 && graySelectors.length === 0) return;

  const style = document.createElement("style");
  style.textContent = [buildStyleText(selectors), buildGrayscaleStyleText(graySelectors)].filter(Boolean).join("\n");
  document.documentElement.append(style);
}

void run();

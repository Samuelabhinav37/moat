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
  buildStyleText,
  mergeDomainShards,
  selectorsForHostname,
  type CosmeticManifest,
} from "./cosmeticSelectors";
import { isDisabledHere } from "./siteDisabled";

async function fetchJson<T>(path: string): Promise<T> {
  return (await fetch(browser.runtime.getURL(path))).json() as Promise<T>;
}

async function run(): Promise<void> {
  if (await isDisabledHere()) return;

  const manifest = await fetchJson<CosmeticManifest>("rules/cosmetics-manifest.json");
  const [meta, ...shards] = await Promise.all([
    fetchJson<{ generic: string[]; exceptions: Record<string, string[]> }>(`rules/${manifest.meta}`),
    ...manifest.domainShards.map((file) => fetchJson<Record<string, string[]>>(`rules/${file}`)),
  ]);

  const index = { generic: meta.generic, exceptions: meta.exceptions, perDomain: mergeDomainShards(shards) };
  const selectors = selectorsForHostname(index, location.hostname);
  if (selectors.length === 0) return;

  const style = document.createElement("style");
  style.textContent = buildStyleText(selectors);
  document.documentElement.append(style);
}

void run();

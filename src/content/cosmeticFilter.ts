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

// Schedules work in a browser idle period when available; falls back to a
// plain macrotask (still yields to the event loop, just without idle-
// awareness) on anything that doesn't implement it -- Firefox has shipped
// requestIdleCallback since version 55, well under Moat's own
// strict_min_version, so this fallback is defense-in-depth, not a real
// compatibility need today.
function scheduleIdleWork(callback: (deadline: IdleDeadline) => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(callback, { timeout: 2000 });
  } else {
    setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0);
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
 *
 * Runs incrementally across idle periods, in fixed-size batches, rather than
 * one synchronous pass over the whole set -- measured directly (real
 * Chrome, not jsdom, since jsdom's CSS engine isn't representative) against
 * the full ~17k generic selector set: ~4 seconds of blocking main-thread
 * work on a 5,000-element DOM, ~560ms even on a modest 800-element page.
 * That's a real, likely-already-happening freeze right at page-load-
 * complete on any moderately complex page (a long feed, a big article), not
 * a hypothetical "if reported" risk. TRIM_BATCH_SIZE keeps each idle
 * slice's worst-case cost bounded to roughly a frame's worth of work even
 * on that same 5,000-element DOM, rather than either the single ~4s block
 * this replaces or an unboundedly large per-slice batch.
 */
const TRIM_BATCH_SIZE = 200;

function trimUnmatchedGenericRules(styleEl: HTMLStyleElement, genericSelectors: string[]): void {
  let index = 0;
  const stillMatching: string[] = [];

  function step(): void {
    stillMatching.push(...selectorsStillMatching(document, genericSelectors.slice(index, index + TRIM_BATCH_SIZE)));
    index += TRIM_BATCH_SIZE;
    if (index < genericSelectors.length) {
      scheduleIdleWork(step);
      return;
    }
    if (stillMatching.length < genericSelectors.length) {
      styleEl.textContent = buildStyleText(stillMatching);
    }
  }

  scheduleIdleWork(step);
}

void run();

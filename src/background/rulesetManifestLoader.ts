// Fetches and caches rules/manifest.json for the background worker. Split
// out from shared/rulesetManifest.ts (which stays free of any
// webextension-polyfill import so its pure logic is testable without a
// browser extension context) so filterGroups.ts and matchStats.ts -- both
// of which fetch this same file in the same worker context -- share one
// module-scope cache instead of each keeping its own duplicate copy.
import browser from "webextension-polyfill";
import type { RulesetManifestEntry } from "../shared/rulesetManifest";

let manifestCache: RulesetManifestEntry[] | null = null;

export async function loadRulesetManifest(): Promise<RulesetManifestEntry[]> {
  if (manifestCache) return manifestCache;
  const url = browser.runtime.getURL("rules/manifest.json");
  manifestCache = (await (await fetch(url)).json()) as RulesetManifestEntry[];
  return manifestCache;
}

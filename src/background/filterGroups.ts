// Applies per-filter-list on/off state (Settings.filterGroups, plus the
// master enabled switch) via declarativeNetRequest.updateEnabledRulesets --
// entirely at runtime, no rebuild needed. Always recomputes and applies the
// *full* enabled/disabled state for every toggleable group rather than a
// diff: there are only ~11 groups, so idempotent full application is cheap
// and avoids drift if something updates state outside this module.
import browser from "webextension-polyfill";
import { groupChunkIds, summarizeFilterLists, type RulesetManifestEntry } from "../shared/rulesetManifest";
import { effectiveFilterGroupState } from "./filterGroupState";
import type { Settings } from "../types";

let manifestCache: RulesetManifestEntry[] | null = null;

async function loadManifest(): Promise<RulesetManifestEntry[]> {
  if (manifestCache) return manifestCache;
  const url = browser.runtime.getURL("rules/manifest.json");
  manifestCache = (await (await fetch(url)).json()) as RulesetManifestEntry[];
  return manifestCache;
}

export async function applyFilterGroupState(settings: Settings): Promise<void> {
  const manifest = await loadManifest();
  const groups = summarizeFilterLists(manifest).map((list) => list.group);
  const state = effectiveFilterGroupState(settings.enabled, settings.filterGroups, groups);

  const enableRulesetIds: string[] = [];
  const disableRulesetIds: string[] = [];
  for (const [group, enabled] of Object.entries(state)) {
    (enabled ? enableRulesetIds : disableRulesetIds).push(...groupChunkIds(manifest, group));
  }

  try {
    await browser.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  } catch {
    // Stale cached manifest, or the browser's enabled-ruleset budget --
    // leave whatever's currently active alone rather than throwing out of
    // setSettings().
  }
}

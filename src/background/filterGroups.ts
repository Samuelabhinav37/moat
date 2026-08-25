// Applies per-filter-list on/off state (Settings.filterGroups, plus the
// master enabled switch) via declarativeNetRequest.updateEnabledRulesets --
// entirely at runtime, no rebuild needed. Always recomputes and applies the
// *full* enabled/disabled state for every toggleable group rather than a
// diff: there are only ~11 groups, so idempotent full application is cheap
// and avoids drift if something updates state outside this module.
import browser from "webextension-polyfill";
import { groupChunkIds, summarizeFilterLists } from "../shared/rulesetManifest";
import { effectiveFilterGroupState } from "./filterGroupState";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import type { Settings } from "../types";

const STATUS_KEY = "filterGroupStatus";

export interface FilterGroupStatus {
  ok: boolean;
  timestamp: number;
}

/** Lets the options page surface "your filter-list selection didn't fully
 * apply" instead of showing toggles as changed with no indication the
 * underlying declarativeNetRequest call actually failed (a stale cached
 * manifest, or Chrome's enabled-ruleset budget). */
export async function getFilterGroupStatus(): Promise<FilterGroupStatus | null> {
  const stored = await browser.storage.local.get(STATUS_KEY);
  return (stored[STATUS_KEY] as FilterGroupStatus | undefined) ?? null;
}

export async function applyFilterGroupState(settings: Settings): Promise<void> {
  const manifest = await loadRulesetManifest();
  const groups = summarizeFilterLists(manifest).map((list) => list.group);
  const state = effectiveFilterGroupState(settings.enabled, settings.filterGroups, groups);

  const enableRulesetIds: string[] = [];
  const disableRulesetIds: string[] = [];
  for (const [group, enabled] of Object.entries(state)) {
    (enabled ? enableRulesetIds : disableRulesetIds).push(...groupChunkIds(manifest, group));
  }

  try {
    await browser.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    await browser.storage.local.set({ [STATUS_KEY]: { ok: true, timestamp: Date.now() } satisfies FilterGroupStatus });
  } catch {
    // Stale cached manifest, or the browser's enabled-ruleset budget --
    // leave whatever's currently active alone rather than throwing out of
    // setSettings(). Record it so the options page can surface it instead
    // of silently showing a toggle that didn't actually take effect.
    await browser.storage.local.set({ [STATUS_KEY]: { ok: false, timestamp: Date.now() } satisfies FilterGroupStatus });
  }
}

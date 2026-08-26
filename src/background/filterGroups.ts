// Applies per-filter-list on/off state (Settings.filterGroups, plus the
// master enabled switch) via declarativeNetRequest.updateEnabledRulesets --
// entirely at runtime, no rebuild needed. Always recomputes and applies the
// *full* enabled/disabled state for every toggleable group rather than a
// diff: there are only ~11 groups, so idempotent full application is cheap
// and avoids drift if something updates state outside this module.
import browser from "webextension-polyfill";
import { groupChunkIds, summarizeFilterLists } from "../shared/rulesetManifest";
import { effectiveFilterGroupState, orderGroupsByDropPriority } from "./filterGroupState";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import type { Settings } from "../types";

const STATUS_KEY = "filterGroupStatus";

export interface FilterGroupStatus {
  ok: boolean;
  timestamp: number;
  /** Groups that had to be left disabled because the full desired set didn't
   * fit the browser's shared static-rule budget, even though the user's
   * settings ask for them on -- see applyFilterGroupState's retry loop.
   * Present (possibly empty) whenever the underlying call succeeded at all;
   * absent only when even the single highest-priority group didn't fit. */
  droppedGroups?: string[];
  /** Chrome's own count of static rules still available across every
   * installed extension (declarativeNetRequest.getAvailableStaticRuleCount),
   * captured only when nothing could be enabled at all -- lets the options
   * page show a real number instead of just "something didn't fit." */
  availableStaticRuleCount?: number;
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
  const lists = summarizeFilterLists(manifest);
  const state = effectiveFilterGroupState(
    settings.enabled,
    settings.filterGroups,
    lists.map((list) => list.group)
  );

  const wantOff = lists.filter((list) => !state[list.group]).map((list) => list.group);
  // Ordered least-essential-first (annoyance/cosmetic, then ads/trackers,
  // security last) -- see orderGroupsByDropPriority. The retry loop below
  // drops from the front of this list one group at a time.
  const wantOn = orderGroupsByDropPriority(lists.filter((list) => state[list.group]));
  const idsFor = (groups: string[]): string[] => groups.flatMap((group) => groupChunkIds(manifest, group));

  // Try the full desired set first; if the browser's shared static-rule
  // budget can't hold it all (declarativeNetRequest.updateEnabledRulesets is
  // atomic -- it either fully succeeds or fully rejects), progressively
  // drop the least-essential groups and retry, rather than an all-or-
  // nothing failure that could leave *every* group disabled even though
  // most of them would easily fit alone.
  for (let drop = 0; drop <= wantOn.length; drop++) {
    const enabling = drop === 0 ? wantOn : wantOn.slice(0, -drop);
    const droppedGroups = drop === 0 ? [] : wantOn.slice(-drop);
    try {
      await browser.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: idsFor(enabling),
        disableRulesetIds: idsFor([...wantOff, ...droppedGroups]),
      });
      await browser.storage.local.set({
        [STATUS_KEY]: {
          ok: droppedGroups.length === 0,
          timestamp: Date.now(),
          droppedGroups: droppedGroups.length > 0 ? droppedGroups : undefined,
        } satisfies FilterGroupStatus,
      });
      return;
    } catch {
      // Didn't fit even after dropping `drop` group(s) -- drop one more and retry.
    }
  }

  // Nothing fit at all, not even the single highest-priority group alone.
  // Leave whatever's currently active alone rather than throwing out of
  // setSettings(); record diagnostics so the options page can show a real
  // number instead of just "something didn't fit."
  let availableStaticRuleCount: number | undefined;
  try {
    availableStaticRuleCount = await browser.declarativeNetRequest.getAvailableStaticRuleCount();
  } catch {
    // Older browser or the call itself is unavailable.
  }
  await browser.storage.local.set({
    [STATUS_KEY]: { ok: false, timestamp: Date.now(), availableStaticRuleCount } satisfies FilterGroupStatus,
  });
}

// Applies per-filter-list on/off state (Settings.filterGroups, plus the
// master enabled switch) via declarativeNetRequest.updateEnabledRulesets --
// entirely at runtime, no rebuild needed. Always recomputes and applies the
// *full* enabled/disabled state for every toggleable group rather than a
// diff: there are only ~11 groups, so idempotent full application is cheap
// and avoids drift if something updates state outside this module.
import browser from "webextension-polyfill";
import { groupChunkIds, summarizeFilterLists, type RulesetManifestEntry } from "../shared/rulesetManifest";
import { effectiveFilterGroupState, orderGroupsByDropPriority } from "./filterGroupState";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import type { Settings } from "../types";

const STATUS_KEY = "filterGroupStatus";
// storage.session (not local) -- deliberately gone on browser restart/
// extension reload, same lifetime as the "have we tried this exact state
// before" question this answers. See applyFilterGroupState's fast path.
const APPLIED_FINGERPRINT_KEY = "filterGroupAppliedFingerprint";

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

/** Same desired-state inputs every apply depends on: settings.enabled/
 * filterGroups (what the user asked for) plus the manifest's own baked-in
 * id/enabled-by-default list (changes only on an extension update). Sorted
 * so key order in the stored object can't produce a spurious "changed"
 * result. */
function computeFingerprint(settings: Settings, manifest: RulesetManifestEntry[]): string {
  const groupsKey = Object.entries(settings.filterGroups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, on]) => `${group}=${on}`)
    .join(",");
  const manifestKey = manifest.map((entry) => `${entry.id}:${entry.enabled}`).join(",");
  return `${settings.enabled}|${groupsKey}|${manifestKey}`;
}

export interface ApplyFilterGroupOptions {
  /** Bypasses the "nothing changed since last time" fast path below --
   * used once a day by liveUpdates.ts's alarm to notice budget that freed
   * up (or got worse) for reasons entirely outside Moat's own settings,
   * e.g. another extension being disabled/enabled -- see the
   * lightweight-architecture roadmap doc. Every other caller (settings
   * changes, managed-policy changes, and the reapply that runs on every
   * service-worker cold start) leaves this off. */
  force?: boolean;
}

export async function applyFilterGroupState(settings: Settings, options: ApplyFilterGroupOptions = {}): Promise<void> {
  const manifest = await loadRulesetManifest();
  const lists = summarizeFilterLists(manifest);
  const state = effectiveFilterGroupState(
    settings.enabled,
    settings.filterGroups,
    lists.map((list) => list.group)
  );

  const fingerprint = computeFingerprint(settings, manifest);
  if (!options.force) {
    // MV3 service workers re-run their whole top-level module (including
    // the reapplySettings() call that reaches here) on every cold start --
    // any page navigation after ~30s idle is enough -- not just when
    // settings actually change. Skipping declarativeNetRequest.updateEnabledRulesets
    // entirely when the desired state is byte-for-byte identical to the
    // last time it was FULLY applied (no groups dropped) avoids redundant
    // work on every one of those wake-ups. Only set after a fully
    // successful apply below, so a degraded (budget-limited) state always
    // keeps retrying rather than getting stuck on a stale "done" cache.
    const cached = await browser.storage.session.get(APPLIED_FINGERPRINT_KEY);
    if (cached[APPLIED_FINGERPRINT_KEY] === fingerprint) return;
  }

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
    // wantOn is ordered least-essential-first, so dropping from the FRONT
    // drops the least-essential groups first -- security-category groups
    // sit at the end and are the last to go.
    const enabling = wantOn.slice(drop);
    const droppedGroups = wantOn.slice(0, drop);
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
      if (droppedGroups.length === 0) {
        await browser.storage.session.set({ [APPLIED_FINGERPRINT_KEY]: fingerprint });
      } else {
        // Degraded state -- never cache this as "done" so the next call
        // (next SW wake, or the daily reconciliation retry) keeps trying,
        // in case budget frees up for reasons outside Moat's own settings.
        await browser.storage.session.remove(APPLIED_FINGERPRINT_KEY);
      }
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

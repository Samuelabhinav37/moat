// storage.local-only rolling usage counters behind the Settings options
// page's new metric rows/sparkline/drawer bars -- never synced, same
// posture as settings.ts's SYNC_STATUS_KEY (a separate key, never folded
// into STORAGE_KEY, so it's excluded from the storage.sync mirror and the
// export/import payload by construction, not by an extra exclusion check).
import browser from "webextension-polyfill";
import {
  EMPTY_STATE,
  pruneOldDays,
  recordBlockedTotal as recordBlockedTotalPure,
  recordCompanyMatches as recordCompanyMatchesPure,
  recordSignalEvent as recordSignalEventPure,
  summarize,
  type UsageStatsState,
} from "../shared/usageStatsState";
import type { UsageSignal, UsageSummaryResponse } from "../types";

const USAGE_STATS_KEY = "usageStats";

async function readState(): Promise<UsageStatsState> {
  const stored = await browser.storage.local.get(USAGE_STATS_KEY);
  return (stored[USAGE_STATS_KEY] as UsageStatsState | undefined) ?? EMPTY_STATE;
}

// Same single-file-queue reasoning as settings.ts's `pending`: a rapid
// sequence of block events (a page load's dynamic catch plus its static
// breakdown, a content script's signal message landing moments later) each
// reading their own separately-fetched "current state" would race and the
// slower write would silently discard the faster one's already-applied
// change.
let pending: Promise<unknown> = Promise.resolve();

function mutate(updater: (current: UsageStatsState, when: number) => UsageStatsState): Promise<void> {
  const when = Date.now();
  const result = pending.then(async () => {
    const current = await readState();
    const next = pruneOldDays(updater(current, when), when);
    if (next !== current) await browser.storage.local.set({ [USAGE_STATS_KEY]: next });
  });
  pending = result.catch(() => {});
  return result;
}

export function recordBlockedTotal(hostname: string, count: number): Promise<void> {
  return mutate((state, when) => recordBlockedTotalPure(state, hostname, count, when));
}

export function recordCompanyMatches(hostname: string, companyBreakdown: Record<string, number>): Promise<void> {
  return mutate((state, when) => recordCompanyMatchesPure(state, hostname, companyBreakdown, when));
}

export function recordSignalEvent(signal: UsageSignal, hostname: string, count = 1): Promise<void> {
  return mutate((state, when) => recordSignalEventPure(state, signal, hostname, count, when));
}

export async function getUsageSummary(): Promise<UsageSummaryResponse> {
  const state = await readState();
  return summarize(state, Date.now());
}

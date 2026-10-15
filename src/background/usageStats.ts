// storage.local-only rolling usage counters behind the Settings options
// page's new metric rows/sparkline/drawer bars -- never synced, same
// posture as settings.ts's SYNC_STATUS_KEY (a separate key, never folded
// into STORAGE_KEY, so it's excluded from the storage.sync mirror and the
// export/import payload by construction, not by an extra exclusion check).
import browser from "webextension-polyfill";
import {
  EMPTY_STATE,
  pruneOldDays,
  recordBlockKinds as recordBlockKindsPure,
  recordBlockedTotal as recordBlockedTotalPure,
  recordCompanyMatches as recordCompanyMatchesPure,
  recordPageStop as recordPageStopPure,
  recordPurposes as recordPurposesPure,
  recordSignalEvent as recordSignalEventPure,
  summarize,
  type UsageStatsState,
} from "../shared/usageStatsState";
import type { BlockKinds, UsageSignal, UsageSummaryResponse } from "../types";
import type { PageStopReason } from "../shared/usageStatsState";

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

// A page load records several things a moment apart (its total, kinds,
// companies, purposes, then the late re-read). They're collected and
// written together once things go quiet, one storage write instead of four
// to eight per page. The worker lives far longer than this delay.
const FLUSH_DELAY_MS = 2000;
let queued: { updater: (current: UsageStatsState, when: number) => UsageStatsState; when: number }[] = [];
let waiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function mutate(updater: (current: UsageStatsState, when: number) => UsageStatsState): Promise<void> {
  queued.push({ updater, when: Date.now() });
  const done = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
  flushTimer ??= setTimeout(() => void flushUsageStats().catch(() => {}), FLUSH_DELAY_MS);
  return done;
}

/** Writes every queued update now, in one read and one write. Exported for
 * getUsageSummary and tests. */
export function flushUsageStats(): Promise<void> {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  const batch = queued;
  const batchWaiters = waiters;
  queued = [];
  waiters = [];
  const result = pending.then(async () => {
    if (batch.length === 0) return;
    const current = await readState();
    let next = current;
    for (const { updater, when } of batch) next = pruneOldDays(updater(next, when), when);
    if (next !== current) await browser.storage.local.set({ [USAGE_STATS_KEY]: next });
  });
  pending = result.catch(() => {});
  result.then(
    () => batchWaiters.forEach((w) => w.resolve()),
    (error: unknown) => batchWaiters.forEach((w) => w.reject(error))
  );
  return result;
}

export function recordBlockedTotal(hostname: string, count: number): Promise<void> {
  return mutate((state, when) => recordBlockedTotalPure(state, hostname, count, when));
}

export function recordBlockKinds(kinds: Partial<BlockKinds>, hostname?: string): Promise<void> {
  return mutate((state, when) => recordBlockKindsPure(state, kinds, when, hostname));
}

export function recordCompanyMatches(hostname: string, companyBreakdown: Record<string, number>): Promise<void> {
  return mutate((state, when) => recordCompanyMatchesPure(state, hostname, companyBreakdown, when));
}

export function recordPurposes(purposes: Record<string, number>): Promise<void> {
  return mutate((state, when) => recordPurposesPure(state, purposes, when));
}

export function recordPageStop(hostname: string, reason?: PageStopReason): Promise<void> {
  return mutate((state, when) => recordPageStopPure(state, hostname, when, reason));
}

export function recordSignalEvent(signal: UsageSignal, hostname: string, count = 1): Promise<void> {
  return mutate((state, when) => recordSignalEventPure(state, signal, hostname, count, when));
}

export async function getUsageSummary(): Promise<UsageSummaryResponse> {
  await flushUsageStats().catch(() => {});
  const state = await readState();
  return summarize(state, Date.now());
}

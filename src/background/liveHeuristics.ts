// In-memory, per-tab "did this heuristic fire on the CURRENT page load"
// tracker behind the Diagnostics page's Heuristics section (DR-16). Deliberately
// not storage.local: this is reset on every navigation (see resetForNavigation,
// called from index.ts's webNavigation.onCommitted the same way blockStats.ts's
// own per-tab breakdown is), so it always answers "what happened on THIS page
// load", not a rolling history -- that's usageStats.ts's job.
import type { UsageSignal } from "../types";

export interface FiredInfo {
  count: number;
  lastFiredAt: number;
}

const firedByTab = new Map<number, Partial<Record<UsageSignal, FiredInfo>>>();

export function recordFired(tabId: number, signal: UsageSignal): void {
  const current = firedByTab.get(tabId) ?? {};
  const existing = current[signal];
  firedByTab.set(tabId, {
    ...current,
    [signal]: { count: (existing?.count ?? 0) + 1, lastFiredAt: Date.now() },
  });
}

export function getFired(tabId: number): Partial<Record<UsageSignal, FiredInfo>> {
  return firedByTab.get(tabId) ?? {};
}

export function resetForNavigation(tabId: number): void {
  firedByTab.delete(tabId);
}

export function forgetTab(tabId: number): void {
  firedByTab.delete(tabId);
}

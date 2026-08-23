// Per-tab count of the popup/redirect firewall's own real-time catches
// (mainWorldGuard.ts's window-open/synthetic-click interceptions, plus the
// tab safety net in popupGuard.ts). Kept in memory only -- a restart or tab
// close naturally clears it, there is nothing here worth persisting to disk.
// Painting the toolbar badge is blockStats.ts's job, since the visible
// number also includes the static ads/trackers/popups breakdown from
// matchStats.ts -- this module only tracks its own slice of that total.
const countsByTab = new Map<number, number>();

export function getCount(tabId: number): number {
  return countsByTab.get(tabId) ?? 0;
}

export function recordBlock(tabId: number): void {
  countsByTab.set(tabId, getCount(tabId) + 1);
}

export function resetCount(tabId: number): void {
  countsByTab.delete(tabId);
}

export function forgetTab(tabId: number): void {
  countsByTab.delete(tabId);
}

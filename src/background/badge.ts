// Per-tab count of the popup/redirect firewall's own real-time catches
// (mainWorldGuard.ts's window-open/synthetic-click interceptions, plus the
// tab safety net in popupGuard.ts). Kept in memory only -- a restart or tab
// close naturally clears it, there is nothing here worth persisting to disk.
// Painting the toolbar badge is blockStats.ts's job, since the visible
// number also includes the static ads/trackers/popups breakdown from
// matchStats.ts -- this module only tracks its own slice of that total.
import { clearTabFromMaps } from "./tabMapCleanup";

const countsByTab = new Map<number, number>();

export function getCount(tabId: number): number {
  return countsByTab.get(tabId) ?? 0;
}

export function recordBlock(tabId: number): void {
  countsByTab.set(tabId, getCount(tabId) + 1);
}

function clearTab(tabId: number): void {
  clearTabFromMaps(tabId, countsByTab);
}

export const resetCount = clearTab;
export const forgetTab = clearTab;

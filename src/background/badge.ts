import browser from "webextension-polyfill";

// Per-tab session counters, kept in memory only. A restart or tab close
// naturally clears them -- there is nothing here worth persisting to disk.
const countsByTab = new Map<number, number>();

export function getCount(tabId: number): number {
  return countsByTab.get(tabId) ?? 0;
}

export async function recordBlock(tabId: number): Promise<void> {
  const next = getCount(tabId) + 1;
  countsByTab.set(tabId, next);
  await paintBadge(tabId, next);
}

export function resetCount(tabId: number): void {
  countsByTab.delete(tabId);
  void paintBadge(tabId, 0);
}

export function forgetTab(tabId: number): void {
  countsByTab.delete(tabId);
}

async function paintBadge(tabId: number, count: number): Promise<void> {
  const text = count > 0 ? String(count) : "";
  try {
    await browser.action.setBadgeText({ tabId, text });
    await browser.action.setBadgeBackgroundColor({ tabId, color: "#5b6b73" });
  } catch {
    // Tab may have closed between the event firing and this call landing.
  }
}

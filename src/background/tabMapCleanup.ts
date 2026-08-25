// Shared by badge.ts and matchStats.ts: both keep one or more per-tab Maps
// and expose the exact same "delete this tab's entry" operation under two
// names (a "reset on navigate" call site and a "forget on tab close" call
// site) -- this is the one place that logic lives, so the two names can't
// drift apart.
interface Deletable {
  delete(tabId: number): boolean;
}

export function clearTabFromMaps(tabId: number, ...maps: Deletable[]): void {
  for (const map of maps) map.delete(tabId);
}

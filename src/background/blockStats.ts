// Combines the two sources of "what got blocked on this tab": badge.ts's
// real-time popup/redirect firewall catches, and matchStats.ts's static
// ads/trackers/popups breakdown from declarativeNetRequest's own match
// feedback. Also owns painting the toolbar badge, since that number has to
// reflect both sources -- neither module paints on its own.
import browser from "webextension-polyfill";
import { forgetTab as forgetDynamicTab, getCount, recordBlock, resetCount } from "./badge";
import {
  forgetTab as forgetBreakdownTab,
  getBreakdown,
  getCompanyBreakdown,
  refreshBreakdown,
  resetBreakdown,
  type Breakdown,
} from "./matchStats";
import { recordBlockedTotal, recordCompanyMatches } from "./usageStats";

export type { Breakdown };

/** The dynamic firewall count folds into "popups": it's real-time catches of
 * the same kind of thing the static AdGuard Popups filter blocks by domain. */
export function combinedBreakdown(tabId: number): Breakdown {
  const breakdown = getBreakdown(tabId);
  return { ...breakdown, popups: breakdown.popups + getCount(tabId) };
}

/** The dynamic firewall's real-time popup catches have no associated DNR
 * rule, so they carry no company attribution -- this is purely the static
 * breakdown's company detail, passed through unchanged. */
export function combinedCompanyBreakdown(tabId: number): Record<string, number> {
  return getCompanyBreakdown(tabId);
}

export function combinedTotal(tabId: number): number {
  const breakdown = combinedBreakdown(tabId);
  return breakdown.ads + breakdown.trackers + breakdown.popups;
}

async function paint(tabId: number): Promise<void> {
  const text = combinedTotal(tabId) > 0 ? String(combinedTotal(tabId)) : "";
  try {
    await browser.action.setBadgeText({ tabId, text });
    await browser.action.setBadgeBackgroundColor({ tabId, color: "#5b6b73" });
  } catch {
    // Tab may have closed between the event firing and this call landing.
  }
}

/** hostname is the real-time firewall's own best guess at what tab it caught
 * this on (sender.tab.url in background/index.ts's "blocked" handler) --
 * used only to attribute the local usage-counter total, never for blocking
 * itself. Empty string (e.g. a tab with no committed URL yet) just skips
 * that attribution rather than recording against "". */
export async function recordDynamicCatch(tabId: number, hostname: string): Promise<void> {
  recordBlock(tabId);
  await paint(tabId);
  if (hostname) void recordBlockedTotal(hostname, 1);
}

export function resetForNavigation(tabId: number): void {
  resetCount(tabId);
  resetBreakdown(tabId);
  void paint(tabId);
}

/** Same hostname-attribution posture as recordDynamicCatch above -- the
 * navigating tab's own hostname, from background/index.ts's
 * webNavigation.onCompleted details.url. */
export async function refreshStaticBreakdown(tabId: number, hostname: string): Promise<void> {
  const breakdown = await refreshBreakdown(tabId);
  await paint(tabId);
  if (!hostname) return;
  const total = breakdown.ads + breakdown.trackers + breakdown.popups;
  if (total > 0) void recordBlockedTotal(hostname, total);
  void recordCompanyMatches(hostname, getCompanyBreakdown(tabId));
}

export function forgetTab(tabId: number): void {
  forgetDynamicTab(tabId);
  forgetBreakdownTab(tabId);
}

// Combines the sources of "what got blocked on this tab": badge.ts's
// real-time popup/redirect firewall catches, matchStats.ts's static
// ads/trackers/popups breakdown from declarativeNetRequest's own match
// feedback, and liveBlocks.ts's quota-free count of refused requests (the
// total never depends on getMatchedRules succeeding). Also owns painting the
// toolbar badge, since that number has to reflect all of them.
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
import { NOTHING_RECORDED, unrecorded, type Recorded } from "../shared/statsDelta";
import { forgetLive, getLiveCount, resetLive } from "./liveBlocks";

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

/** Network blocks on the current page: the live count, or the rule-based
 * count when that's higher (redirect stand-ins are matched rules but not
 * refused requests). */
function staticTotal(tabId: number): number {
  const b = getBreakdown(tabId);
  return Math.max(getLiveCount(tabId), b.ads + b.trackers + b.popups);
}

export function combinedTotal(tabId: number): number {
  return staticTotal(tabId) + getCount(tabId);
}

/** Blocks counted in the total that the ads/trackers/pop-ups split doesn't
 * cover yet, because getMatchedRules hasn't been readable since they
 * happened. The popup shows these as "N not sorted yet". */
export function unsortedCount(tabId: number): number {
  const b = combinedBreakdown(tabId);
  return Math.max(0, combinedTotal(tabId) - (b.ads + b.trackers + b.popups));
}

// A live block can arrive hundreds of times a second on a bad page; repaint
// the badge at most twice a second per tab.
const paintTimers = new Map<number, ReturnType<typeof setTimeout>>();
export function onLiveBlock(tabId: number): void {
  if (paintTimers.has(tabId)) return;
  paintTimers.set(
    tabId,
    setTimeout(() => {
      paintTimers.delete(tabId);
      void paint(tabId);
    }, 500)
  );
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

// What each tab's current page has already added to the weekly usage stats.
// The page is refreshed more than once (see refreshStaticBreakdown's
// callers), and each refresh adds only what's new.
const recordedByTab = new Map<number, Recorded>();

export function resetForNavigation(tabId: number, pageStart?: number): void {
  recordedByTab.delete(tabId);
  resetLive(tabId, pageStart);
  resetCount(tabId);
  resetBreakdown(tabId, pageStart);
  void paint(tabId);
}

/** Re-reads the tab's matched rules, repaints the badge, and adds anything
 * new to the weekly stats under the tab's own hostname. Called when the page
 * finishes loading, again a few seconds later (ads often load after the
 * load event), and when the popup opens. */
export async function refreshStaticBreakdown(tabId: number, hostname: string): Promise<void> {
  await refreshBreakdown(tabId);
  await paint(tabId);
  if (!hostname) return;
  const total = staticTotal(tabId);
  const fresh = unrecorded(recordedByTab.get(tabId) ?? NOTHING_RECORDED, total, getCompanyBreakdown(tabId));
  recordedByTab.set(tabId, fresh.next);
  if (fresh.total > 0) void recordBlockedTotal(hostname, fresh.total);
  if (Object.keys(fresh.counts).length > 0) void recordCompanyMatches(hostname, fresh.counts);
}

export function forgetTab(tabId: number): void {
  recordedByTab.delete(tabId);
  forgetLive(tabId);
  forgetDynamicTab(tabId);
  forgetBreakdownTab(tabId);
}

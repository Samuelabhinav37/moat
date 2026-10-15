// The check-in's state: when Moat was installed, when the popup asked "How is
// Moat working for you?", whether it was answered, "Don't ask again", and the
// last moment something went wrong (a report, a paused site, a stopped page),
// which keeps the question away for a few days. The rules live in
// shared/checkinLogic.ts. Stored on this device only, never sent; an answer
// sends only what popup/checkinCard.ts shows.
import browser from "webextension-polyfill";
import { shouldAskCheckin, weeksSince, type CheckinState } from "../shared/checkinLogic";

const KEY = "checkin";
const USAGE_STATS_KEY = "usageStats";

async function read(): Promise<CheckinState> {
  return ((await browser.storage.local.get(KEY))[KEY] as CheckinState | undefined) ?? {};
}

async function write(patch: Partial<CheckinState>): Promise<void> {
  await browser.storage.local.set({ [KEY]: { ...(await read()), ...patch } });
}

/** From onInstalled: an install starts the clock. Copies from before this
 * feature start it on their first update, so they too wait the full ten days. */
export async function recordInstallTime(reason: string): Promise<void> {
  const state = await read();
  if (reason === "install" || state.installedAt === undefined) await write({ installedAt: Date.now() });
}

/** A report was sent, a site was paused or a page was stopped. Best effort:
 * callers don't wait for it, so it never rejects. */
export async function noteTrouble(): Promise<void> {
  try {
    await write({ lastTroubleAt: Date.now() });
  } catch {
    // Storage unavailable: the check-in just won't know about this moment.
  }
}

/** Days in Moat's 14-day usage history with anything blocked. */
async function activeDays(): Promise<number> {
  const stored = (await browser.storage.local.get(USAGE_STATS_KEY))[USAGE_STATS_KEY] as { days?: Record<string, { total?: number }> } | undefined;
  return Object.values(stored?.days ?? {}).filter((day) => (day.total ?? 0) > 0).length;
}

export async function checkinDue(now = Date.now()): Promise<{ ask: boolean; weeksSinceInstall: number }> {
  const state = await read();
  return { ask: shouldAskCheckin(state, await activeDays(), now), weeksSinceInstall: weeksSince(state.installedAt, now) };
}

/** The question was shown: it counts as an ask whether or not it's answered. */
export async function markCheckinAsked(): Promise<void> {
  const state = await read();
  await write({ asks: [...(state.asks ?? []), Date.now()].slice(-6) });
}

export async function markCheckinAnswered(): Promise<void> {
  await write({ answeredAt: Date.now() });
}

export async function markCheckinNever(): Promise<void> {
  await write({ never: true });
}

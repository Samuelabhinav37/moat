// Timed pauses ("for 1 hour", "for 1 day") end on their own. One alarm is
// set for the earliest end time; when it fires, every pause that has ended
// is resumed and the alarm moves to the next one. Alarms survive the worker
// sleeping and the browser restarting (a missed one fires at startup), so
// a pause never outlasts its time by more than about a minute.
import browser from "webextension-polyfill";
import type { Settings } from "../types";
import { endExpiredPauses } from "./settings";

export const PAUSE_ALARM = "moat-pause-expiry";

/** The earliest end time among pauses that are still in effect, or null. */
export function nextPauseEnd(settings: Pick<Settings, "disabledSites" | "pausedUntil">): number | null {
  const ends = settings.disabledSites.map((host) => settings.pausedUntil[host]).filter((until): until is number => typeof until === "number");
  return ends.length ? Math.min(...ends) : null;
}

/** Never throws: a missing alarm only delays the end of a pause until the
 * next startup, and must not stop the rest of the settings applying. */
export async function schedulePauseExpiry(settings: Pick<Settings, "disabledSites" | "pausedUntil">): Promise<void> {
  try {
    const next = nextPauseEnd(settings);
    if (next === null) await browser.alarms.clear(PAUSE_ALARM);
    else await browser.alarms.create(PAUSE_ALARM, { when: Math.max(next, Date.now() + 1000) });
  } catch {
    // No alarms API here (tests), or the browser refused.
  }
}

export function initPauseExpiry(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PAUSE_ALARM) void endExpiredPauses(Date.now());
  });
  // Pauses that ended while the browser was closed.
  void endExpiredPauses(Date.now());
}

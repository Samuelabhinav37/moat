// How long a pause lasts: an hour, a day, or until resumed. Shared by the
// popup and Settings so both offer the same choices and say "until" the
// same way. Pure, so it's testable with a fixed clock.

export type PauseLength = "hour" | "day" | "always";

export const PAUSE_LENGTHS: readonly PauseLength[] = ["hour", "day", "always"];

/** End time (epoch ms) for a pause starting now, or undefined for one that lasts. */
export function pauseEnd(length: PauseLength, now: number): number | undefined {
  if (length === "hour") return now + 60 * 60_000;
  if (length === "day") return now + 24 * 60 * 60_000;
  return undefined;
}

/** "3:40 PM" today, "tomorrow 9:00 AM", or "Fri 9:00 AM" later in the week. */
export function pauseEndLabel(until: number, now: number, tomorrow: string, locale?: string): string {
  const end = new Date(until);
  const time = end.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(end) - day(new Date(now))) / 864e5);
  if (days <= 0) return time;
  if (days === 1) return `${tomorrow} ${time}`;
  return `${end.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
}

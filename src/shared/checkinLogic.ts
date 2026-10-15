// When the popup may ask "How is Moat working for you?" Apple's guidance for
// rating prompts, applied: only after real use, never in the first days,
// never right after something went wrong, weeks apart, three times a year
// at most, and never again once someone says so. Pure, so every rule has a
// test (checkinLogic.test.ts).

export const DAY = 86_400_000;
export const FIRST_ASK_AFTER_DAYS = 10;
export const MIN_ACTIVE_DAYS = 5;
export const QUIET_AFTER_TROUBLE_DAYS = 3;
export const DAYS_BETWEEN_ASKS = 14;
export const MAX_ASKS_PER_YEAR = 3;
export const DAYS_AFTER_ANSWER = 180;

export interface CheckinState {
  /** When Moat was installed (or, for copies from before 0.11.287, first saw this feature). */
  installedAt?: number;
  /** Every time the question was shown. */
  asks?: number[];
  /** When it was last answered. */
  answeredAt?: number;
  /** "Don't ask again". */
  never?: boolean;
  /** The last report, paused site or stopped page: a bad moment to ask. */
  lastTroubleAt?: number;
}

export function shouldAskCheckin(state: CheckinState, activeDays: number, now: number): boolean {
  if (state.never || state.installedAt === undefined) return false;
  if (now - state.installedAt < FIRST_ASK_AFTER_DAYS * DAY) return false;
  if (activeDays < MIN_ACTIVE_DAYS) return false;
  if (state.lastTroubleAt !== undefined && now - state.lastTroubleAt < QUIET_AFTER_TROUBLE_DAYS * DAY) return false;
  if (state.answeredAt !== undefined && now - state.answeredAt < DAYS_AFTER_ANSWER * DAY) return false;
  const asks = state.asks ?? [];
  if (asks.filter((t) => now - t < 365 * DAY).length >= MAX_ASKS_PER_YEAR) return false;
  const last = asks.length ? Math.max(...asks) : undefined;
  if (last !== undefined && now - last < DAYS_BETWEEN_ASKS * DAY) return false;
  return true;
}

/** Whole weeks since install, for the answer. */
export function weeksSince(installedAt: number | undefined, now: number): number {
  return installedAt === undefined ? 0 : Math.min(520, Math.max(0, Math.floor((now - installedAt) / (7 * DAY))));
}

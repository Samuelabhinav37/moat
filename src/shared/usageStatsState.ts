// Pure reducers + summarization over the rolling local usage-counter state
// (background/usageStats.ts owns the storage.local/mutate-queue wiring
// around this). Kept free of any webextension-polyfill import, same
// convention as filterGroupState.ts/matchedRuleCategories.ts, so the date-
// bucketing and retention-pruning edge cases are testable without a browser
// extension context.
import type { UsageSignal, UsageSignalSummary, UsageSummaryResponse } from "../types";

export const SIGNAL_KEYS: readonly UsageSignal[] = [
  "fingerprint",
  "cookieBannerReject",
  "feedAdRemoval",
  "grayscaleAds",
  "cnameUncloak",
  "leakedPasswordCheck",
  "searchSlop",
];

/** 7-day sparkline/bars + the "same weekday last week" comparison need 8
 * days of history; a few extra days of slack cover a service worker that
 * wakes up late (idle browser, no navigation) and misses recording exactly
 * at local midnight. */
export const RETENTION_DAYS = 14;

// Bounding, not precision -- see settingsPortability.ts's MAX_ARRAY_LENGTH /
// cnameUncloak.ts's MAX_CACHE_ENTRIES for the same "cap it, don't try to be
// clever about eviction" posture elsewhere in this codebase. A hostname (or
// company) beyond the cap on a given day is simply not added -- the day's
// own `total`/signal `count` still includes it, only the hostname-list
// detail is capped.
export const MAX_HOSTNAMES_PER_BUCKET = 500;
export const MAX_COMPANIES_PER_DAY = 200;

export interface HostnameCounts {
  count: number;
  hostnames: string[];
}

export interface UsageDay {
  date: string; // "YYYY-MM-DD", local calendar day
  total: number;
  hostnames: string[];
  signals: Partial<Record<UsageSignal, HostnameCounts>>;
  companies: Record<string, HostnameCounts>;
}

export interface UsageStatsState {
  days: Record<string, UsageDay>;
}

export const EMPTY_STATE: UsageStatsState = { days: {} };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar day, not UTC -- "vs 1,075 last Thursday" is a claim about
 * the user's own week. */
export function dateKey(when: number): string {
  const d = new Date(when);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** dateKey() `deltaDays` away (negative = earlier) from `when`. Goes through
 * a real Date so month/year boundaries fall out for free. */
export function shiftDateKey(when: number, deltaDays: number): string {
  const d = new Date(when);
  d.setDate(d.getDate() + deltaDays);
  return dateKey(d.getTime());
}

function emptyDay(date: string): UsageDay {
  return { date, total: 0, hostnames: [], signals: {}, companies: {} };
}

function addHostname(hostnames: string[], hostname: string): string[] {
  if (hostnames.includes(hostname)) return hostnames;
  if (hostnames.length >= MAX_HOSTNAMES_PER_BUCKET) return hostnames;
  return [...hostnames, hostname];
}

function withDay(state: UsageStatsState, date: string, update: (day: UsageDay) => UsageDay): UsageStatsState {
  const current = state.days[date] ?? emptyDay(date);
  return { days: { ...state.days, [date]: update(current) } };
}

export function recordBlockedTotal(
  state: UsageStatsState,
  hostname: string,
  count: number,
  when: number
): UsageStatsState {
  if (count <= 0) return state;
  return withDay(state, dateKey(when), (day) => ({
    ...day,
    total: day.total + count,
    hostnames: addHostname(day.hostnames, hostname),
  }));
}

export function recordCompanyMatches(
  state: UsageStatsState,
  hostname: string,
  companyBreakdown: Record<string, number>,
  when: number
): UsageStatsState {
  const entries = Object.entries(companyBreakdown).filter(([, count]) => count > 0);
  if (entries.length === 0) return state;
  return withDay(state, dateKey(when), (day) => {
    const companies = { ...day.companies };
    for (const [company, count] of entries) {
      const existing = companies[company];
      if (existing) {
        companies[company] = { count: existing.count + count, hostnames: addHostname(existing.hostnames, hostname) };
      } else if (Object.keys(companies).length < MAX_COMPANIES_PER_DAY) {
        companies[company] = { count, hostnames: [hostname] };
      }
    }
    return { ...day, companies };
  });
}

export function recordSignalEvent(
  state: UsageStatsState,
  signal: UsageSignal,
  hostname: string,
  count: number,
  when: number
): UsageStatsState {
  if (count <= 0) return state;
  return withDay(state, dateKey(when), (day) => {
    const existing = day.signals[signal];
    const next: HostnameCounts = existing
      ? { count: existing.count + count, hostnames: addHostname(existing.hostnames, hostname) }
      : { count, hostnames: [hostname] };
    return { ...day, signals: { ...day.signals, [signal]: next } };
  });
}

/** Drops any day older than RETENTION_DAYS -- date keys are lexicographically
 * ordered same as chronological, so this is a cheap string comparison.
 * Returns `state` unchanged (same reference) when nothing was actually
 * older than the cutoff, so a caller that only writes on a real change
 * (background/usageStats.ts's mutate) doesn't hit storage.local on every
 * single call just because pruning ran. */
export function pruneOldDays(state: UsageStatsState, when: number): UsageStatsState {
  const cutoff = shiftDateKey(when, -RETENTION_DAYS);
  const entries = Object.entries(state.days);
  if (entries.every(([date]) => date >= cutoff)) return state;
  return { days: Object.fromEntries(entries.filter(([date]) => date >= cutoff)) };
}

function dayOrEmpty(state: UsageStatsState, date: string): UsageDay {
  return state.days[date] ?? emptyDay(date);
}

/** Oldest-to-today date keys for the trailing `count` days, `when`'s own day included. */
function trailingDateKeys(when: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDateKey(when, i - (count - 1)));
}

export function summarize(state: UsageStatsState, when: number): UsageSummaryResponse {
  const last7 = trailingDateKeys(when, 7);
  const today = dayOrEmpty(state, last7[last7.length - 1]!);

  const lastWeekKey = shiftDateKey(when, -7);
  const haveLastWeek = lastWeekKey in state.days;
  const lastWeekSameWeekday = haveLastWeek ? { total: dayOrEmpty(state, lastWeekKey).total } : null;

  const sparkline = last7.map((date) => dayOrEmpty(state, date).total);

  const bySignal: Partial<Record<UsageSignal, UsageSignalSummary>> = {};
  for (const signal of SIGNAL_KEYS) {
    const todaySignal = today.signals[signal];
    const weekHostnames = new Set<string>();
    const sevenDayBars = last7.map((date) => {
      const day = dayOrEmpty(state, date);
      const bucket = day.signals[signal];
      if (!bucket) return 0;
      for (const hostname of bucket.hostnames) weekHostnames.add(hostname);
      return bucket.hostnames.length;
    });
    if (todaySignal || weekHostnames.size > 0) {
      bySignal[signal] = {
        todayCount: todaySignal?.count ?? 0,
        todayHostnameCount: todaySignal?.hostnames.length ?? 0,
        weekHostnameCount: weekHostnames.size,
        sevenDayBars,
      };
    }
  }

  const companyTotals = new Map<string, { count: number; hostnames: Set<string> }>();
  for (const date of last7) {
    for (const [company, bucket] of Object.entries(dayOrEmpty(state, date).companies)) {
      const existing = companyTotals.get(company);
      if (existing) {
        existing.count += bucket.count;
        for (const hostname of bucket.hostnames) existing.hostnames.add(hostname);
      } else {
        companyTotals.set(company, { count: bucket.count, hostnames: new Set(bucket.hostnames) });
      }
    }
  }
  const companiesThisWeek = [...companyTotals.entries()]
    .map(([company, { count, hostnames }]) => ({ company, count, hostnameCount: hostnames.size }))
    .sort((a, b) => b.count - a.count);

  return {
    today: { total: today.total, hostnameCount: today.hostnames.length },
    lastWeekSameWeekday,
    sparkline,
    bySignal,
    companiesThisWeek,
  };
}

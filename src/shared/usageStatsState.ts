// Pure reducers + summarization over the rolling local usage-counter state
// (background/usageStats.ts owns the storage.local/mutate-queue wiring
// around this). Kept free of any webextension-polyfill import, same
// convention as filterGroupState.ts/matchedRuleCategories.ts, so the date-
// bucketing and retention-pruning edge cases are testable without a browser
// extension context.
import type { BlockKinds, UsageSignal, UsageSignalSummary, UsageSummaryResponse } from "../types";
import type { BlockKind } from "./blockedPage";

/** Sites listed under each company on Trackers. */
export const COMPANY_SITES_SHOWN = 8;

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
  /** Blocks by kind. Absent on days recorded before 0.11.154. */
  kinds?: BlockKinds;
  /** Blocks per site (capped like `hostnames`). From 0.11.204. */
  hostCounts?: Record<string, number>;
  /** Blocks per site by kind (capped like `hostnames`), for a site's own
   * panel on Sites. From 0.11.238. */
  hostKinds?: Record<string, BlockKinds>;
  /** Blocks per local hour, 24 entries. From 0.11.204. */
  hours?: number[];
  /** Tracker blocks by TrackerDB purpose. From 0.11.204. */
  purposes?: Record<string, number>;
}

/** Which list stopped a page, and what kind of stop it was (from 0.11.231;
 * older stops have neither). */
export interface PageStopReason {
  list: string;
  kind: BlockKind;
}

export interface PageStop extends Partial<PageStopReason> {
  hostname: string;
  time: number;
}

export interface UsageStatsState {
  days: Record<string, UsageDay>;
  /** Whole pages Moat refused to load, newest last, capped. */
  pageStops?: PageStop[];
}

export const MAX_PAGE_STOPS = 50;

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
  return { ...state, days: { ...state.days, [date]: update(current) } };
}

function addCount(counts: Record<string, number> | undefined, key: string, count: number): Record<string, number> {
  const next = { ...counts };
  if (key in next || Object.keys(next).length < MAX_HOSTNAMES_PER_BUCKET) next[key] = (next[key] ?? 0) + count;
  return next;
}

export function recordBlockedTotal(
  state: UsageStatsState,
  hostname: string,
  count: number,
  when: number
): UsageStatsState {
  if (count <= 0) return state;
  const hour = new Date(when).getHours();
  return withDay(state, dateKey(when), (day) => {
    const hours = day.hours?.length === 24 ? [...day.hours] : new Array<number>(24).fill(0);
    hours[hour] = (hours[hour] ?? 0) + count;
    return {
      ...day,
      total: day.total + count,
      hostnames: addHostname(day.hostnames, hostname),
      hostCounts: addCount(day.hostCounts, hostname, count),
      hours,
    };
  });
}

/** Tracker blocks by purpose (TrackerDB category). */
export function recordPurposes(state: UsageStatsState, purposes: Record<string, number>, when: number): UsageStatsState {
  const entries = Object.entries(purposes).filter(([, count]) => count > 0);
  if (entries.length === 0) return state;
  return withDay(state, dateKey(when), (day) => {
    let next = day.purposes;
    for (const [purpose, count] of entries) next = addCount(next, purpose, count);
    return { ...day, purposes: next };
  });
}

/** A whole page Moat refused to load. The same site twice in a minute is one stop. */
export function recordPageStop(state: UsageStatsState, hostname: string, when: number, reason?: PageStopReason): UsageStatsState {
  if (!hostname) return state;
  const stops = state.pageStops ?? [];
  const last = stops[stops.length - 1];
  if (last && last.hostname === hostname && when - last.time < 60_000) return state;
  return { ...state, pageStops: [...stops, { hostname, time: when, ...(reason ? { list: reason.list, kind: reason.kind } : {}) }].slice(-MAX_PAGE_STOPS) };
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

export const NO_KINDS: BlockKinds = { ads: 0, trackers: 0, popups: 0 };

export function recordBlockKinds(state: UsageStatsState, kinds: Partial<BlockKinds>, when: number, hostname?: string): UsageStatsState {
  const entries = (Object.entries(kinds) as [keyof BlockKinds, number][]).filter(([, count]) => count > 0);
  if (entries.length === 0) return state;
  return withDay(state, dateKey(when), (day) => {
    const next = { ...NO_KINDS, ...day.kinds };
    for (const [kind, count] of entries) next[kind] += count;
    if (!hostname) return { ...day, kinds: next };
    const hostKinds = { ...day.hostKinds };
    if (hostname in hostKinds || Object.keys(hostKinds).length < MAX_HOSTNAMES_PER_BUCKET) {
      const site = { ...NO_KINDS, ...hostKinds[hostname] };
      for (const [kind, count] of entries) site[kind] += count;
      hostKinds[hostname] = site;
    }
    return { ...day, kinds: next, hostKinds };
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
  const stops = state.pageStops ?? [];
  const keptStops = stops.filter((stop) => dateKey(stop.time) >= cutoff);
  if (entries.every(([date]) => date >= cutoff) && keptStops.length === stops.length) return state;
  return {
    ...state,
    days: Object.fromEntries(entries.filter(([date]) => date >= cutoff)),
    ...(state.pageStops ? { pageStops: keptStops } : {}),
  };
}

function dayOrEmpty(state: UsageStatsState, date: string): UsageDay {
  return state.days[date] ?? emptyDay(date);
}

/** `when` moved by whole local days. */
function shiftTime(when: number, deltaDays: number): number {
  const d = new Date(when);
  d.setDate(d.getDate() + deltaDays);
  return d.getTime();
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
  const weekKinds = { ...NO_KINDS };
  for (const date of last7) {
    const kinds = dayOrEmpty(state, date).kinds;
    if (!kinds) continue;
    weekKinds.ads += kinds.ads;
    weekKinds.trackers += kinds.trackers;
    weekKinds.popups += kinds.popups;
  }

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

  // Distinct companies per day, oldest to today -- the Trackers tab's own
  // sparkline. Only 14 days of history are ever retained (see
  // RETENTION_DAYS), so this is a 7-*day* trend, not the design mock's
  // illustrative "last 7 weeks" -- there's no honest way to show a 7-week
  // trend without keeping ~49 days of raw per-company data, which nothing
  // else here needs.
  const companiesTrend = last7.map((date) => Object.keys(dayOrEmpty(state, date).companies).length);

  const dailyKinds = last7.map((date) => ({ ...NO_KINDS, ...dayOrEmpty(state, date).kinds }));
  const prev7 = trailingDateKeys(shiftTime(when, -7), 7);
  let previousWeek: UsageSummaryResponse["previousWeek"] = null;
  if (haveLastWeek) {
    const kinds = { ...NO_KINDS };
    const companies = new Set<string>();
    let total = 0;
    for (const date of prev7) {
      const day = dayOrEmpty(state, date);
      total += day.total;
      if (day.kinds) {
        kinds.ads += day.kinds.ads;
        kinds.trackers += day.kinds.trackers;
        kinds.popups += day.kinds.popups;
      }
      for (const company of Object.keys(day.companies)) companies.add(company);
    }
    previousWeek = {
      total,
      kinds,
      companies: companies.size,
      daily: prev7.map((date) => dayOrEmpty(state, date).total),
      dailyKinds: prev7.map((date) => ({ ...NO_KINDS, ...dayOrEmpty(state, date).kinds })),
    };
  }

  const sites = new Set<string>();
  const siteCounts = new Map<string, number>();
  const purposes: Record<string, number> = {};
  for (const date of last7) {
    const day = dayOrEmpty(state, date);
    for (const hostname of day.hostnames) sites.add(hostname);
    for (const [hostname, count] of Object.entries(day.hostCounts ?? {})) siteCounts.set(hostname, (siteCounts.get(hostname) ?? 0) + count);
    for (const [purpose, count] of Object.entries(day.purposes ?? {})) purposes[purpose] = (purposes[purpose] ?? 0) + count;
  }
  const siteKinds = new Map<string, BlockKinds>();
  for (const date of last7) {
    for (const [hostname, k] of Object.entries(dayOrEmpty(state, date).hostKinds ?? {})) {
      const sum = siteKinds.get(hostname) ?? { ...NO_KINDS };
      sum.ads += k.ads;
      sum.trackers += k.trackers;
      sum.popups += k.popups;
      siteKinds.set(hostname, sum);
    }
  }
  // Each site's panel lists the tracker companies seen there, most blocked first.
  const companiesBySite = new Map<string, string[]>();
  for (const [company, { hostnames }] of [...companyTotals.entries()].sort((a, b) => b[1].count - a[1].count)) {
    for (const hostname of hostnames) companiesBySite.set(hostname, [...(companiesBySite.get(hostname) ?? []), company]);
  }
  const topSites = [...siteCounts.entries()]
    .map(([hostname, count]) => ({ hostname, count }))
    .sort((a, b) => b.count - a.count || a.hostname.localeCompare(b.hostname))
    .slice(0, 20)
    .map((site) => ({ ...site, kinds: siteKinds.get(site.hostname) ?? null, companies: companiesBySite.get(site.hostname) ?? [] }));
  const hours = last7.map((date) => {
    const h = dayOrEmpty(state, date).hours;
    return h?.length === 24 ? [...h] : new Array<number>(24).fill(0);
  });
  const weekStart = last7[0]!;
  const pageStops = (state.pageStops ?? [])
    .filter((stop) => dateKey(stop.time) >= weekStart)
    .reverse()
    .slice(0, 20);
  // Each company's sites, the ones with the most blocks first.
  const companySites: Record<string, string[]> = {};
  const byBlocks = (a: string, b: string) => (siteCounts.get(b) ?? 0) - (siteCounts.get(a) ?? 0) || a.localeCompare(b);
  for (const [company, { hostnames }] of companyTotals) companySites[company] = [...hostnames].sort(byBlocks).slice(0, COMPANY_SITES_SHOWN);
  // Each day's top sites, so "When" can say where a busy day happened.
  const dailyTopSites = last7.map((date) =>
    Object.entries(dayOrEmpty(state, date).hostCounts ?? {})
      .map(([hostname, count]) => ({ hostname, count }))
      .sort((a, b) => b.count - a.count || a.hostname.localeCompare(b.hostname))
      .slice(0, 3)
  );
  const trackerSites = new Set<string>();
  for (const { hostnames } of companyTotals.values()) for (const hostname of hostnames) trackerSites.add(hostname);

  return {
    today: { total: today.total, hostnameCount: today.hostnames.length },
    lastWeekSameWeekday,
    sparkline,
    weekKinds,
    bySignal,
    companiesThisWeek,
    companiesTrend,
    dailyKinds,
    previousWeek,
    weekSiteCount: sites.size,
    topSites,
    hours,
    purposes,
    pageStops,
    companySites,
    dailyTopSites,
    trackerSiteCount: trackerSites.size,
  };
}

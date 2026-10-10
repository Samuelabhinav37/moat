import { describe, expect, it } from "vitest";
import {
  recordPageStop,
  recordPurposes,
  EMPTY_STATE,
  MAX_HOSTNAMES_PER_BUCKET,
  RETENTION_DAYS,
  dateKey,
  pruneOldDays,
  recordBlockKinds,
  recordBlockedTotal,
  recordCompanyMatches,
  recordSignalEvent,
  shiftDateKey,
  summarize,
  type UsageStatsState,
} from "./usageStatsState";

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed instant, safely away from month/year boundaries, so every test
// below is deterministic regardless of when it actually runs.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime(); // 2026-06-15 local noon

describe("dateKey / shiftDateKey", () => {
  it("formats a local calendar day as YYYY-MM-DD", () => {
    expect(dateKey(NOW)).toBe("2026-06-15");
  });

  it("shifts across a month boundary", () => {
    expect(shiftDateKey(new Date(2026, 5, 1).getTime(), -1)).toBe("2026-05-31");
  });

  it("shifts across a year boundary", () => {
    expect(shiftDateKey(new Date(2026, 0, 1).getTime(), -1)).toBe("2025-12-31");
  });
});

describe("recordBlockedTotal", () => {
  it("creates today's bucket and adds the hostname", () => {
    const state = recordBlockedTotal(EMPTY_STATE, "example.com", 3, NOW);
    expect(state.days["2026-06-15"]).toMatchObject({ total: 3, hostnames: ["example.com"] });
  });

  it("accumulates across calls the same day without duplicating the hostname", () => {
    let state = recordBlockedTotal(EMPTY_STATE, "example.com", 3, NOW);
    state = recordBlockedTotal(state, "example.com", 2, NOW + 1000);
    state = recordBlockedTotal(state, "other.com", 1, NOW + 2000);
    expect(state.days["2026-06-15"]).toMatchObject({ total: 6, hostnames: ["example.com", "other.com"] });
  });

  it("is a no-op (same reference) for a zero or negative count", () => {
    expect(recordBlockedTotal(EMPTY_STATE, "example.com", 0, NOW)).toBe(EMPTY_STATE);
    expect(recordBlockedTotal(EMPTY_STATE, "example.com", -1, NOW)).toBe(EMPTY_STATE);
  });

  it("caps distinct hostnames per day without dropping the running total", () => {
    let state: UsageStatsState = EMPTY_STATE;
    for (let i = 0; i < MAX_HOSTNAMES_PER_BUCKET + 5; i++) {
      state = recordBlockedTotal(state, `host${i}.com`, 1, NOW);
    }
    const day = state.days["2026-06-15"]!;
    expect(day.hostnames.length).toBe(MAX_HOSTNAMES_PER_BUCKET);
    expect(day.total).toBe(MAX_HOSTNAMES_PER_BUCKET + 5);
  });
});

describe("recordCompanyMatches", () => {
  it("accumulates per-company counts and hostnames across calls", () => {
    let state = recordCompanyMatches(EMPTY_STATE, "example.com", { Acme: 2, Globex: 1 }, NOW);
    state = recordCompanyMatches(state, "other.com", { Acme: 1 }, NOW + 1000);
    const day = state.days["2026-06-15"]!;
    expect(day.companies.Acme).toEqual({ count: 3, hostnames: ["example.com", "other.com"] });
    expect(day.companies.Globex).toEqual({ count: 1, hostnames: ["example.com"] });
  });

  it("ignores zero-count companies and is a no-op when nothing is positive", () => {
    expect(recordCompanyMatches(EMPTY_STATE, "example.com", { Acme: 0 }, NOW)).toBe(EMPTY_STATE);
  });
});

describe("recordSignalEvent", () => {
  it("tracks per-signal count and distinct hostnames", () => {
    let state = recordSignalEvent(EMPTY_STATE, "searchSlop", "example.com", 3, NOW);
    state = recordSignalEvent(state, "searchSlop", "example.com", 2, NOW + 1000);
    state = recordSignalEvent(state, "searchSlop", "other.com", 1, NOW + 2000);
    expect(state.days["2026-06-15"]!.signals.searchSlop).toEqual({
      count: 6,
      hostnames: ["example.com", "other.com"],
    });
  });

  it("keeps different signals independent", () => {
    let state = recordSignalEvent(EMPTY_STATE, "searchSlop", "example.com", 1, NOW);
    state = recordSignalEvent(state, "fingerprint", "example.com", 1, NOW);
    expect(Object.keys(state.days["2026-06-15"]!.signals).sort()).toEqual(["fingerprint", "searchSlop"]);
  });
});

describe("pruneOldDays", () => {
  it("drops a day older than the retention window", () => {
    const oldKey = dateKey(NOW - (RETENTION_DAYS + 1) * DAY_MS);
    const state: UsageStatsState = {
      days: { [oldKey]: { date: oldKey, total: 5, hostnames: [], signals: {}, companies: {} } },
    };
    expect(pruneOldDays(state, NOW).days[oldKey]).toBeUndefined();
  });

  it("keeps a day within the retention window", () => {
    const recentKey = dateKey(NOW - (RETENTION_DAYS - 1) * DAY_MS);
    const state: UsageStatsState = {
      days: { [recentKey]: { date: recentKey, total: 5, hostnames: [], signals: {}, companies: {} } },
    };
    expect(pruneOldDays(state, NOW).days[recentKey]).toBeDefined();
  });

  it("returns the same reference when nothing needs pruning", () => {
    const state = recordBlockedTotal(EMPTY_STATE, "example.com", 1, NOW);
    expect(pruneOldDays(state, NOW)).toBe(state);
  });
});

describe("summarize", () => {
  it("reports today's total/hostname count and a 7-entry sparkline", () => {
    let state = recordBlockedTotal(EMPTY_STATE, "example.com", 10, NOW);
    state = recordBlockedTotal(state, "other.com", 5, NOW);
    state = recordBlockedTotal(state, "example.com", 4, NOW - DAY_MS);

    const summary = summarize(state, NOW);
    expect(summary.today).toEqual({ total: 15, hostnameCount: 2 });
    expect(summary.sparkline).toHaveLength(7);
    expect(summary.sparkline[6]).toBe(15); // today is the last entry
    expect(summary.sparkline[5]).toBe(4); // yesterday
  });

  it("is null for lastWeekSameWeekday until 8 days of history exist", () => {
    const state = recordBlockedTotal(EMPTY_STATE, "example.com", 10, NOW);
    expect(summarize(state, NOW).lastWeekSameWeekday).toBeNull();
  });

  it("surfaces lastWeekSameWeekday once that day has a recorded bucket", () => {
    const state = recordBlockedTotal(EMPTY_STATE, "example.com", 7, NOW - 7 * DAY_MS);
    expect(summarize(state, NOW).lastWeekSameWeekday).toEqual({ total: 7 });
  });

  it("omits a signal from bySignal entirely when it has no activity in the trailing week", () => {
    const state = recordBlockedTotal(EMPTY_STATE, "example.com", 1, NOW);
    expect(summarize(state, NOW).bySignal.searchSlop).toBeUndefined();
  });

  it("computes weekHostnameCount as the union across the trailing 7 days, not a sum", () => {
    let state = recordSignalEvent(EMPTY_STATE, "searchSlop", "example.com", 1, NOW);
    state = recordSignalEvent(state, "searchSlop", "example.com", 1, NOW - DAY_MS); // same hostname, another day
    state = recordSignalEvent(state, "searchSlop", "other.com", 1, NOW - DAY_MS);

    const signal = summarize(state, NOW).bySignal.searchSlop!;
    expect(signal.weekHostnameCount).toBe(2);
    expect(signal.todayHostnameCount).toBe(1);
    expect(signal.sevenDayBars).toHaveLength(7);
  });

  it("ranks companiesThisWeek by count, aggregated across the trailing 7 days", () => {
    let state = recordCompanyMatches(EMPTY_STATE, "example.com", { Acme: 2 }, NOW);
    state = recordCompanyMatches(state, "example.com", { Acme: 1, Globex: 5 }, NOW - DAY_MS);

    const companies = summarize(state, NOW).companiesThisWeek;
    expect(companies[0]).toEqual({ company: "Globex", count: 5, hostnameCount: 1 });
    expect(companies[1]).toEqual({ company: "Acme", count: 3, hostnameCount: 1 });
  });

  it("returns an all-zero summary for a fully empty state", () => {
    const summary = summarize(EMPTY_STATE, NOW);
    expect(summary.today).toEqual({ total: 0, hostnameCount: 0 });
    expect(summary.sparkline).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(summary.bySignal).toEqual({});
    expect(summary.companiesThisWeek).toEqual([]);
    expect(summary.companiesTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("counts distinct companies per day for companiesTrend", () => {
    let state = recordCompanyMatches(EMPTY_STATE, "example.com", { Acme: 1, Globex: 1 }, NOW);
    state = recordCompanyMatches(state, "example.com", { Acme: 1 }, NOW - DAY_MS);
    const trend = summarize(state, NOW).companiesTrend;
    expect(trend).toHaveLength(7);
    expect(trend[6]).toBe(2); // today: Acme + Globex
    expect(trend[5]).toBe(1); // yesterday: Acme only
  });
});

describe("recordBlockKinds / weekKinds", () => {
  it("adds each kind to the day, ignoring zeros", () => {
    let state: UsageStatsState = EMPTY_STATE;
    state = recordBlockKinds(state, { ads: 3, trackers: 2 }, NOW);
    state = recordBlockKinds(state, { popups: 1, ads: 0 }, NOW);
    expect(state.days[dateKey(NOW)]!.kinds).toEqual({ ads: 3, trackers: 2, popups: 1 });
    expect(recordBlockKinds(state, { ads: 0 }, NOW)).toBe(state);
  });

  it("sums the last 7 days, and days recorded before the split count as nothing", () => {
    let state: UsageStatsState = EMPTY_STATE;
    // An older-format day: a total but no kinds.
    state = recordBlockedTotal(state, "old.example", 40, NOW - 2 * DAY_MS);
    state = recordBlockKinds(state, { ads: 5 }, NOW - 1 * DAY_MS);
    state = recordBlockKinds(state, { ads: 1, trackers: 4, popups: 2 }, NOW);
    // Outside the week.
    state = recordBlockKinds(state, { ads: 100 }, NOW - 8 * DAY_MS);
    expect(summarize(state, NOW).weekKinds).toEqual({ ads: 6, trackers: 4, popups: 2 });
  });

  it("is all zeros with no history", () => {
    expect(summarize(EMPTY_STATE, NOW).weekKinds).toEqual({ ads: 0, trackers: 0, popups: 0 });
  });
});

describe("Insights counters (0.11.204)", () => {
  const at = (hour: number, dayOffset = 0) => new Date(2026, 5, 15 + dayOffset, hour, 30, 0).getTime();

  it("counts blocks per site and per hour of the day", () => {
    let state = recordBlockedTotal(EMPTY_STATE, "news.example", 5, at(9));
    state = recordBlockedTotal(state, "news.example", 2, at(21));
    state = recordBlockedTotal(state, "shop.example", 4, at(21));
    const summary = summarize(state, at(22));
    expect(summary.topSites).toEqual([
      { hostname: "news.example", count: 7, kinds: null, companies: [] },
      { hostname: "shop.example", count: 4, kinds: null, companies: [] },
    ]);
    expect(summary.hours[6]![9]).toBe(5);
    expect(summary.hours[6]![21]).toBe(6);
    expect(summary.weekSiteCount).toBe(2);
  });

  it("adds up tracker purposes over the week", () => {
    let state = recordPurposes(EMPTY_STATE, { advertising: 3, site_analytics: 1 }, at(10, -2));
    state = recordPurposes(state, { site_analytics: 2 }, at(10));
    expect(summarize(state, at(11)).purposes).toEqual({ advertising: 3, site_analytics: 3 });
  });

  it("keeps whole pages Moat stopped, newest first, once per minute per site, and prunes them with the days", () => {
    let state = recordPageStop(EMPTY_STATE, "paypa1-secure.top", at(10));
    state = recordPageStop(state, "paypa1-secure.top", at(10) + 5_000);
    state = recordPageStop(state, "free-robux.gift", at(11));
    expect(summarize(state, at(12)).pageStops.map((s) => s.hostname)).toEqual(["free-robux.gift", "paypa1-secure.top"]);
    const later = pruneOldDays(state, at(12, 20));
    expect(later.pageStops).toEqual([]);
  });

  it("gives each day's kinds for the chart, and last week's totals once there are 8 days", () => {
    let state = recordBlockKinds(EMPTY_STATE, { ads: 2, trackers: 1 }, at(10));
    expect(summarize(state, at(11)).dailyKinds[6]).toEqual({ ads: 2, trackers: 1, popups: 0 });
    expect(summarize(state, at(11)).previousWeek).toBeNull();
    state = recordBlockedTotal(state, "old.example", 9, at(10, -8));
    state = recordBlockedTotal(state, "x.example", 1, at(10, -7));
    const prev = summarize(state, at(11)).previousWeek!;
    expect(prev).toMatchObject({ total: 10, kinds: { ads: 0, trackers: 0, popups: 0 }, companies: 0 });
    // Last week day by day, oldest first, for the Last week chart.
    expect(prev.daily).toEqual([0, 0, 0, 0, 0, 9, 1]);
    expect(prev.dailyKinds).toHaveLength(7);
  });

  it("lists up to eight sites for each company, most blocks first", () => {
    let state = EMPTY_STATE;
    const sites = ["a.example", "b.example", "c.example", "d.example", "e.example", "f.example", "g.example", "h.example", "i.example"];
    for (const site of sites) state = recordCompanyMatches(state, site, { Google: 1 }, at(10));
    state = recordBlockedTotal(state, "i.example", 50, at(10));
    state = recordBlockedTotal(state, "c.example", 20, at(10));
    const listed = summarize(state, at(11)).companySites.Google!;
    expect(listed).toHaveLength(8);
    expect(listed.slice(0, 2)).toEqual(["i.example", "c.example"]);
  });

  it("gives each day's top three sites", () => {
    let state = recordBlockedTotal(EMPTY_STATE, "a.example", 5, at(10));
    state = recordBlockedTotal(state, "b.example", 9, at(10));
    state = recordBlockedTotal(state, "c.example", 1, at(10));
    state = recordBlockedTotal(state, "d.example", 2, at(10));
    const days = summarize(state, at(10)).dailyTopSites;
    expect(days).toHaveLength(7);
    expect(days[6]!.map((s) => s.hostname)).toEqual(["b.example", "a.example", "d.example"]);
    expect(days[0]).toEqual([]);
  });
});

describe("per-site detail for the Sites panel", () => {
  it("keeps each site's blocks by kind and lists the companies seen there, most blocked first", () => {
    let state: UsageStatsState = EMPTY_STATE;
    state = recordBlockedTotal(state, "news.example", 30, NOW);
    state = recordBlockKinds(state, { ads: 10, trackers: 18, popups: 2 }, NOW, "news.example");
    state = recordBlockKinds(state, { ads: 5 }, NOW);
    state = recordCompanyMatches(state, "news.example", { Meta: 3, Google: 9 }, NOW);
    const site = summarize(state, NOW).topSites.find((s) => s.hostname === "news.example")!;
    expect(site.kinds).toEqual({ ads: 10, trackers: 18, popups: 2 });
    expect(site.companies).toEqual(["Google", "Meta"]);
  });

  it("has no split for a site recorded before it was kept", () => {
    const state = recordBlockedTotal(EMPTY_STATE, "old.example", 4, NOW);
    expect(summarize(state, NOW).topSites[0]).toMatchObject({ hostname: "old.example", kinds: null, companies: [] });
  });
});

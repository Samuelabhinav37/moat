import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE,
  MAX_HOSTNAMES_PER_BUCKET,
  RETENTION_DAYS,
  dateKey,
  pruneOldDays,
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
  });
});

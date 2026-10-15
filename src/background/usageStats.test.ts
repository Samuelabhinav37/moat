import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown>, sets: 0 }));
vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store.data[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          store.sets++;
          Object.assign(store.data, items);
        }),
      },
    },
  },
}));

const { flushUsageStats, getUsageSummary, recordBlockedTotal, recordBlockKinds, recordPurposes } = await import("./usageStats");

describe("usage stats writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.data = {};
    store.sets = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("collects a page's updates and writes them once, after things go quiet", async () => {
    const writes = [recordBlockedTotal("news.example", 5), recordBlockKinds({ ads: 3, trackers: 2 }, "news.example"), recordPurposes({ advertising: 3 })];
    expect(store.sets).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(writes);
    expect(store.sets).toBe(1);
    const summary = await getUsageSummary();
    expect(JSON.stringify(summary)).toContain("news.example");
  });

  it("writes pending updates at once when the summary is read", async () => {
    void recordBlockedTotal("shop.example", 2);
    await flushUsageStats();
    expect(store.sets).toBe(1);
  });
});

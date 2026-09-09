import { describe, expect, it, vi } from "vitest";

// liveUpdates.ts imports the polyfill at module scope. Most of these tests
// call only pure functions that never touch it; getYoutubeQuickFixesStatus
// is the one exception, so storage.local.get gets a working (in-memory) stub
// rather than the bare {} the rest of the file gets away with.
const storageStore: Record<string, unknown> = {};
vi.mock("webextension-polyfill", () => ({
  default: {
    storage: { local: { get: (key: string) => Promise.resolve({ [key]: storageStore[key] }) } },
  },
}));

import {
  MIN_REFETCH_INTERVAL_MS,
  YT_MIN_REFETCH_INTERVAL_MS,
  getYoutubeQuickFixesStatus,
  sha256Hex,
  shouldSkipRefetch,
} from "./liveUpdates";

const HOUR = 60 * 60 * 1000;

describe("shouldSkipRefetch", () => {
  it("does not skip when there is no prior status", () => {
    expect(shouldSkipRefetch(null, Date.now())).toBe(false);
  });

  it("does not skip when the last fetch failed, however recent", () => {
    expect(shouldSkipRefetch({ ok: false, timestamp: Date.now() - HOUR }, Date.now())).toBe(false);
  });

  it("skips when the last successful fetch is inside the window", () => {
    const now = 1_000_000_000_000;
    expect(shouldSkipRefetch({ ok: true, timestamp: now - 6 * HOUR }, now)).toBe(true);
  });

  it("does not skip once the window has elapsed — the daily alarm still refreshes", () => {
    const now = 1_000_000_000_000;
    expect(shouldSkipRefetch({ ok: true, timestamp: now - 20 * HOUR }, now)).toBe(false);
  });

  it("uses an 18h default window (shorter than the 24h alarm period)", () => {
    expect(MIN_REFETCH_INTERVAL_MS).toBe(18 * HOUR);
    expect(MIN_REFETCH_INTERVAL_MS).toBeLessThan(24 * HOUR);
  });
});

describe("sha256Hex", () => {
  it("matches the known SHA-256 of an empty JSON array (the quick-fixes payload)", async () => {
    const bytes = new TextEncoder().encode("[]").buffer;
    expect(await sha256Hex(bytes)).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
  });

  it("is 64 lowercase hex chars and changes with the input", async () => {
    const a = await sha256Hex(new TextEncoder().encode('["a.com"]').buffer);
    const b = await sha256Hex(new TextEncoder().encode('["b.com"]').buffer);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("the YouTube quick-fixes channel", () => {
  it("uses a 45min window, shorter than its own 60min alarm period", () => {
    expect(YT_MIN_REFETCH_INTERVAL_MS).toBe(45 * 60 * 1000);
    expect(YT_MIN_REFETCH_INTERVAL_MS).toBeLessThan(60 * 60 * 1000);
  });

  it("is a distinct skip-guard window from the general channel's 18h one", () => {
    // Same shouldSkipRefetch function, different constant -- the channel's
    // whole value proposition is reacting much faster than the general one.
    expect(YT_MIN_REFETCH_INTERVAL_MS).toBeLessThan(MIN_REFETCH_INTERVAL_MS);
  });

  it("getYoutubeQuickFixesStatus returns null before anything has run", async () => {
    expect(await getYoutubeQuickFixesStatus()).toBeNull();
  });
});

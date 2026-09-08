import { describe, expect, it, vi } from "vitest";

// liveUpdates.ts imports the polyfill at module scope (used only inside
// functions, none of which these tests call). Stub it so the import resolves
// in the node test env -- same pattern as athenaIntegration.test.ts.
vi.mock("webextension-polyfill", () => ({ default: {} }));

import { MIN_REFETCH_INTERVAL_MS, sha256Hex, shouldSkipRefetch } from "./liveUpdates";

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

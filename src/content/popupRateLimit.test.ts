import { describe, expect, it } from "vitest";
import { createPopupRateLimiter } from "./popupRateLimit";

describe("createPopupRateLimiter", () => {
  it("approves up to maxPerWindow calls within the window", () => {
    const limiter = createPopupRateLimiter(2, 20_000);
    expect(limiter.tryApprove(0)).toBe(true);
    expect(limiter.tryApprove(100)).toBe(true);
  });

  it("denies a call beyond maxPerWindow within the same window", () => {
    const limiter = createPopupRateLimiter(2, 20_000);
    limiter.tryApprove(0);
    limiter.tryApprove(100);
    expect(limiter.tryApprove(200)).toBe(false);
  });

  it("does not record a denied attempt -- a later approval still respects the real count", () => {
    const limiter = createPopupRateLimiter(1, 20_000);
    expect(limiter.tryApprove(0)).toBe(true);
    expect(limiter.tryApprove(100)).toBe(false);
    expect(limiter.tryApprove(200)).toBe(false);
    // Still only one real approval on the books -- confirmed by the window
    // test below, which relies on exactly one timestamp having been kept.
  });

  it("allows another approval once the earliest one falls outside the window", () => {
    const limiter = createPopupRateLimiter(1, 1000);
    expect(limiter.tryApprove(0)).toBe(true);
    expect(limiter.tryApprove(999)).toBe(false); // still within the 1000ms window
    expect(limiter.tryApprove(1001)).toBe(true); // now outside it
  });

  it("expires only the timestamps that have actually aged out, not the whole history", () => {
    const limiter = createPopupRateLimiter(2, 1000);
    expect(limiter.tryApprove(0)).toBe(true);
    expect(limiter.tryApprove(500)).toBe(true);
    // At t=1001, the t=0 approval has aged out (1001ms old) but t=500 has not
    // (501ms old) -- exactly one slot should have freed up.
    expect(limiter.tryApprove(1001)).toBe(true);
    expect(limiter.tryApprove(1002)).toBe(false);
  });

  it("defaults to a real, non-trivial limit when constructed with no arguments", () => {
    const limiter = createPopupRateLimiter();
    let approved = 0;
    for (let i = 0; i < 10; i++) {
      if (limiter.tryApprove(i * 10)) approved += 1;
    }
    expect(approved).toBeGreaterThan(0);
    expect(approved).toBeLessThan(10);
  });

  it("each limiter instance tracks its own independent state", () => {
    const a = createPopupRateLimiter(1, 20_000);
    const b = createPopupRateLimiter(1, 20_000);
    expect(a.tryApprove(0)).toBe(true);
    expect(b.tryApprove(0)).toBe(true); // b's own allowance, unaffected by a
    expect(a.tryApprove(1)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { LIVE_LOOKALIKES_FORMAT, MAX_LOOKALIKE_DAILY_ADDS, lookalikeChangeNeedsReview, parseLiveLookalikePayload } from "./liveLookalikes";

const payload = (domains: Record<string, unknown>) => ({ format: LIVE_LOOKALIKES_FORMAT, generated: "", domains });

describe("parseLiveLookalikePayload", () => {
  it("keeps well-formed sites and drops the rest one by one", () => {
    expect(
      parseLiveLookalikePayload(
        payload({
          "paypal-login.example": { brand: "PayPal", added: "2026-10-31" },
          "no-brand.example": { added: "2026-10-31" },
          "bad-brand.example": { brand: "<b>x</b>" },
          "127.0.0.1": { brand: "PayPal" },
          "com": { brand: "PayPal" },
        })
      )
    ).toEqual({ "paypal-login.example": "PayPal" });
  });

  it("refuses the wrong format", () => {
    expect(parseLiveLookalikePayload({ format: 2, domains: {} })).toBeNull();
    expect(parseLiveLookalikePayload({ format: LIVE_LOOKALIKES_FORMAT, domains: null })).toBeNull();
    expect(parseLiveLookalikePayload("x")).toBeNull();
  });
});

describe("lookalikeChangeNeedsReview", () => {
  it("flags a burst of new sites only", () => {
    const many = Array.from({ length: MAX_LOOKALIKE_DAILY_ADDS + 1 }, (_, i) => `s${i}.example`);
    expect(lookalikeChangeNeedsReview([], many)).toMatch(/added/);
    expect(lookalikeChangeNeedsReview(many, [])).toBeNull();
  });
});

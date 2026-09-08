import { describe, expect, it } from "vitest";
import { tokenHash } from "./tokenHash.mjs";
import { tokenHash as tokenHashRuntime } from "../../src/shared/tokenHash.ts";

// Class/id tokens the anchor-extraction step in genericTokenIndex.mjs
// actually produces: plain ad-ish words, hyphen/underscore forms, single
// letters, the empty string (a selector with no usable anchor), a non-ASCII
// token, and a long one.
const SAMPLE_TOKENS = [
  "ad",
  "ads",
  "ad-banner",
  "adBanner",
  "sponsored",
  "promo_box",
  "banner-ad-container",
  "a",
  "",
  "reklamé",
  "x".repeat(200),
];

describe("tokenHash", () => {
  it("returns an unsigned base-36 string", () => {
    for (const token of SAMPLE_TOKENS) {
      const hash = tokenHash(token);
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9a-z]+$/);
    }
  });

  it("is deterministic for the same token", () => {
    expect(tokenHash("ad-banner")).toBe(tokenHash("ad-banner"));
  });

  it("separates tokens that differ only in case", () => {
    expect(tokenHash("adBanner")).not.toBe(tokenHash("adbanner"));
  });

  it("matches the runtime (TypeScript) copy of the same algorithm for every sample token", () => {
    for (const token of SAMPLE_TOKENS) {
      expect(tokenHash(token)).toBe(tokenHashRuntime(token));
    }
  });
});

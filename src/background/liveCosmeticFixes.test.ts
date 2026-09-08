import { describe, expect, it } from "vitest";
import {
  countCosmeticFixSelectors,
  filterValidCosmeticFixes,
  MAX_LIVE_COSMETIC_DOMAINS,
  MAX_LIVE_COSMETIC_SELECTORS_PER_DOMAIN,
} from "./liveCosmeticFixes";

describe("filterValidCosmeticFixes", () => {
  it("keeps well-formed { hostname: [selector] } entries, lowercasing the host", () => {
    const { valid, rejectedDomains } = filterValidCosmeticFixes({
      "YouTube.com": ["ytd-ad-slot-renderer", ".ad-container"],
    });
    expect(valid).toEqual({ "youtube.com": ["ytd-ad-slot-renderer", ".ad-container"] });
    expect(rejectedDomains).toBe(0);
  });

  it("drops selectors that could break out of the <style> block", () => {
    const { valid } = filterValidCosmeticFixes({
      "example.com": [".ok", "a{}", "b<c", "d`e", "x".repeat(600)],
    });
    expect(valid).toEqual({ "example.com": [".ok"] });
  });

  it("drops a domain whose selectors are all unsafe", () => {
    const { valid, rejectedDomains } = filterValidCosmeticFixes({ "example.com": ["a{}", "b<c"] });
    expect(valid).toEqual({});
    expect(rejectedDomains).toBe(1);
  });

  it("rejects a non-hostname key and a non-array value", () => {
    const { valid, rejectedDomains } = filterValidCosmeticFixes({
      "not a host": [".a"],
      "||example.com^": [".b"],
      "good.com": "not-an-array",
    });
    expect(valid).toEqual({});
    expect(rejectedDomains).toBe(3);
  });

  it("returns an empty map for {} / null / an array / a string", () => {
    for (const input of [{}, null, undefined, [".a"], "x", 42]) {
      expect(filterValidCosmeticFixes(input).valid).toEqual({});
    }
  });

  it("caps selectors per domain and total domains", () => {
    const manySelectors = Array.from({ length: MAX_LIVE_COSMETIC_SELECTORS_PER_DOMAIN + 20 }, (_, i) => `.s${i}`);
    expect(filterValidCosmeticFixes({ "a.com": manySelectors }).valid["a.com"]).toHaveLength(
      MAX_LIVE_COSMETIC_SELECTORS_PER_DOMAIN,
    );

    const manyDomains: Record<string, string[]> = {};
    for (let i = 0; i < MAX_LIVE_COSMETIC_DOMAINS + 30; i++) manyDomains[`d${i}.com`] = [".x"];
    expect(Object.keys(filterValidCosmeticFixes(manyDomains).valid).length).toBe(MAX_LIVE_COSMETIC_DOMAINS);
  });
});

describe("countCosmeticFixSelectors", () => {
  it("sums selectors across every domain", () => {
    expect(countCosmeticFixSelectors({ "a.com": [".x", ".y"], "b.com": [".z"] })).toBe(3);
    expect(countCosmeticFixSelectors({})).toBe(0);
  });
});

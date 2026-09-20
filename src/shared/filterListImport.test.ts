import { describe, expect, it } from "vitest";
import { parseFilterListImport } from "./filterListImport";
import { MAX_RECORD_KEYS, MAX_STRING_LENGTH } from "./importBounds";

describe("parseFilterListImport", () => {
  it("parses a block rule", () => {
    const result = parseFilterListImport("||ads.example.com^");
    expect(result.blockedDomains).toEqual(["ads.example.com"]);
    expect(result.allowedDomains).toEqual([]);
    expect(result.cosmeticRules).toEqual({});
    expect(result.skippedLines).toBe(0);
  });

  it("parses an allow (exception) rule", () => {
    const result = parseFilterListImport("@@||shop.example.com^");
    expect(result.allowedDomains).toEqual(["shop.example.com"]);
    expect(result.blockedDomains).toEqual([]);
  });

  it("lowercases domains on capture", () => {
    const result = parseFilterListImport("||ADS.Example.COM^");
    expect(result.blockedDomains).toEqual(["ads.example.com"]);
  });

  it("dedupes repeated block rules", () => {
    const result = parseFilterListImport("||ads.example.com^\n||ads.example.com^");
    expect(result.blockedDomains).toEqual(["ads.example.com"]);
  });

  it("parses a single-domain cosmetic rule", () => {
    const result = parseFilterListImport("example.com##.ad-banner");
    expect(result.cosmeticRules).toEqual({ "example.com": [".ad-banner"] });
  });

  it("parses a comma-separated multi-domain cosmetic rule, applying the selector to each", () => {
    const result = parseFilterListImport("a.example.com,b.example.com##.ad-banner");
    expect(result.cosmeticRules).toEqual({
      "a.example.com": [".ad-banner"],
      "b.example.com": [".ad-banner"],
    });
  });

  it("dedupes repeated selectors for the same host", () => {
    const result = parseFilterListImport("example.com##.ad-banner\nexample.com##.ad-banner");
    expect(result.cosmeticRules).toEqual({ "example.com": [".ad-banner"] });
  });

  it("ignores comments and list headers without counting them as skipped", () => {
    const result = parseFilterListImport("! this is a comment\n[Adblock Plus 2.0]\n||ads.example.com^");
    expect(result.blockedDomains).toEqual(["ads.example.com"]);
    expect(result.skippedLines).toBe(0);
  });

  it("ignores blank lines", () => {
    const result = parseFilterListImport("||ads.example.com^\n\n\n@@||shop.example.com^");
    expect(result.blockedDomains).toEqual(["ads.example.com"]);
    expect(result.allowedDomains).toEqual(["shop.example.com"]);
    expect(result.skippedLines).toBe(0);
  });

  it("skips a generic no-domain cosmetic rule -- Moat has no site-independent custom rule concept", () => {
    const result = parseFilterListImport("##.ad-banner");
    expect(result.cosmeticRules).toEqual({});
    expect(result.skippedLines).toBe(1);
  });

  it("skips a per-domain exception cosmetic rule (~domain##selector)", () => {
    const result = parseFilterListImport("~example.com##.ad-banner");
    expect(result.cosmeticRules).toEqual({});
    expect(result.skippedLines).toBe(1);
  });

  it("skips an unsafe selector even though the domain part matched", () => {
    const result = parseFilterListImport("example.com##div{background:url(x)}");
    expect(result.cosmeticRules).toEqual({});
    expect(result.skippedLines).toBe(1);
  });

  it("skips regex filters, $-modifier filters, and scriptlet rules", () => {
    const result = parseFilterListImport(
      ["/^https?:\\/\\/ads\\./", "||example.com^$third-party", "example.com##+js(abort-on-property-read, foo)"].join("\n")
    );
    expect(result.blockedDomains).toEqual([]);
    expect(result.cosmeticRules).toEqual({});
    expect(result.skippedLines).toBe(3);
  });

  it("handles a realistic mixed export", () => {
    const text = [
      "! Title: My filters",
      "[Adblock Plus 2.0]",
      "||ads.example.com^",
      "||tracker.example.net^",
      "@@||shop.example.com^",
      "example.com##.ad-banner",
      "example.com,other.com##.promo",
      "##.generic-no-domain",
      "/some-regex-filter/",
    ].join("\n");
    const result = parseFilterListImport(text);
    expect(result.blockedDomains.sort()).toEqual(["ads.example.com", "tracker.example.net"]);
    expect(result.allowedDomains).toEqual(["shop.example.com"]);
    expect(result.cosmeticRules).toEqual({
      "example.com": [".ad-banner", ".promo"],
      "other.com": [".promo"],
    });
    expect(result.skippedLines).toBe(2);
  });

  // Regression: cosmeticRules used to be a plain object, so a hostname
  // matching an inherited Object.prototype member name resolved through the
  // prototype chain (truthy, e.g. the Object constructor function) instead
  // of falling back to a fresh Set -- calling .add() on that threw and
  // crashed the whole parse with no user feedback. Now backed by a Map,
  // which has no inherited keys at all.
  describe("hostnames that collide with Object.prototype members", () => {
    // Every domain is lowercased before use (line ~91 above), so only a
    // member name that's ALREADY all-lowercase is a real collision risk here
    // -- "constructor" survives .toLowerCase() unchanged; "toString"/
    // "hasOwnProperty"/"valueOf" don't (their lowercased form isn't a real
    // Object.prototype member), so they were never actually reachable by
    // this specific bug even before the fix. Testing only the real case.
    it("does not throw for a bare 'constructor' hostname and records the rule normally", () => {
      expect(() => parseFilterListImport("constructor##.ad-banner")).not.toThrow();
      const result = parseFilterListImport("constructor##.ad-banner");
      expect(result.cosmeticRules["constructor"]).toEqual([".ad-banner"]);
      expect(result.skippedLines).toBe(0);
    });

    it("does not throw when a prototype-colliding hostname is mixed with ordinary ones", () => {
      const text = ["example.com##.ad-banner", "constructor##.tracker", "other.com##.promo"].join("\n");
      expect(() => parseFilterListImport(text)).not.toThrow();
      const result = parseFilterListImport(text);
      expect(result.cosmeticRules).toEqual({
        "example.com": [".ad-banner"],
        constructor: [".tracker"],
        "other.com": [".promo"],
      });
    });
  });

  describe("bounds enforcement", () => {
    it("caps the number of domains parsed from one comma-separated cosmetic line", () => {
      const manyDomains = Array.from({ length: MAX_RECORD_KEYS + 500 }, (_, i) => `d${i}.example.com`).join(",");
      const result = parseFilterListImport(`${manyDomains}##.ad-banner`);
      expect(Object.keys(result.cosmeticRules).length).toBeLessThanOrEqual(MAX_RECORD_KEYS);
    });

    it("caps the total number of distinct cosmetic-rule hostnames across many lines", () => {
      const lines = Array.from({ length: MAX_RECORD_KEYS + 200 }, (_, i) => `host${i}.example.com##.ad`);
      const result = parseFilterListImport(lines.join("\n"));
      expect(Object.keys(result.cosmeticRules).length).toBeLessThanOrEqual(MAX_RECORD_KEYS);
    });

    it("rejects a single cosmetic-rule domain longer than MAX_STRING_LENGTH", () => {
      const longLabel = "d".repeat(MAX_STRING_LENGTH + 1);
      const result = parseFilterListImport(`${longLabel}.example.com##.ad-banner`);
      expect(result.cosmeticRules).toEqual({});
      expect(result.skippedLines).toBe(1);
    });

    it("rejects a block-rule domain longer than MAX_STRING_LENGTH", () => {
      const longLabel = "d".repeat(MAX_STRING_LENGTH + 1);
      const result = parseFilterListImport(`||${longLabel}.example.com^`);
      expect(result.blockedDomains).toEqual([]);
      expect(result.skippedLines).toBe(1);
    });

    it("rejects a cosmetic selector longer than MAX_STRING_LENGTH", () => {
      const longSelector = `.${"a".repeat(MAX_STRING_LENGTH)}`;
      const result = parseFilterListImport(`example.com##${longSelector}`);
      expect(result.cosmeticRules).toEqual({});
      expect(result.skippedLines).toBe(1);
    });
  });
});

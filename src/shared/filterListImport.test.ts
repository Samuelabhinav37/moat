import { describe, expect, it } from "vitest";
import { parseFilterListImport } from "./filterListImport";

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
});

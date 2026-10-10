import { describe, expect, it } from "vitest";
import { ADCASH_FALLBACK_REGEX, base64Forms, buildPopunderNetworkRules } from "./popunderNetworkRules.mjs";

const re = new RegExp(ADCASH_FALLBACK_REGEX);
const b64 = (s) => Buffer.from(s, "latin1").toString("base64");
// Shaped like the requests measured on 10 Oct 2026: a random host, a short
// random path, one random 24-character parameter, base64 fields in any order.
const fallback = (fields) => `https://qwertyuiopasd.website/8932cg48g?jD0zjKvPsH9Vn7yQbAk1eCTr=${b64(fields)}`;

describe("base64Forms", () => {
  it("spells cbiframe= the three ways base64 can", () => {
    expect(base64Forms("cbiframe=")).toEqual(["Y2JpZnJhbWU9", "NiaWZyYW1lP", "jYmlmcmFtZT"]);
  });
});

describe("Adcash fallback rule", () => {
  it("matches its hidden requests whatever the field order", () => {
    expect(re.test(fallback("cbiframe=1&chmob=%3F0&rbd=1&r=7176486"))).toBe(true);
    expect(re.test(fallback("atv=87.0-pb&r=9364618&cbiframe=1&cbur=0.66"))).toBe(true);
    expect(re.test(fallback("ts=1791655015165&cbWidth=1068&sadbl=2&cbiframe=1"))).toBe(true);
    expect(re.test(fallback("btp=0.9&cbkeywords=&sadbl=2&cbiframe=1&atv=87.0-pa"))).toBe(true);
  });

  it("leaves ordinary requests alone", () => {
    expect(re.test("https://instreams.pro/live3/tv401878773/index.m3u8?st=6PbFR9jzLU88Yw3Y1oncgA&e=1791665498")).toBe(false);
    expect(re.test("https://api.example.com/v1/items?query=" + b64("cbiframe=1"))).toBe(false);
    expect(re.test(fallback("width=1068&height=598&title=hello"))).toBe(false);
    expect(re.test("https://example.com/search?abcdefghijklmnopqrstuvwx=" + b64("q=frames"))).toBe(false);
  });

  it("has no counted repeats, which don't fit Chrome's 2 KB regex budget", () => {
    expect(ADCASH_FALLBACK_REGEX).not.toMatch(/\{\d/);
  });

  it("is a third-party block, case-sensitive, never a page", () => {
    const [rule] = buildPopunderNetworkRules();
    expect(rule.action.type).toBe("block");
    expect(rule.condition.isUrlFilterCaseSensitive).toBe(true);
    expect(rule.condition.domainType).toBe("thirdParty");
    expect(rule.condition.resourceTypes).not.toContain("main_frame");
    expect(rule.condition.resourceTypes).not.toContain("sub_frame");
  });
});

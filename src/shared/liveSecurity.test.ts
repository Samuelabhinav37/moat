import { describe, expect, it } from "vitest";
import {
  LIVE_SECURITY_FORMAT,
  MAX_LIVE_SECURITY_DOMAINS_PER_GROUP,
  cleanSecurityDomains,
  isAllowedSecurityHost,
  parseDomainList,
  parseLiveSecurityPayload,
  securityChangeNeedsReview,
} from "./liveSecurity";

describe("parseDomainList", () => {
  it("reads plain, wildcard and hosts-file lines, skipping comments", () => {
    expect(parseDomainList("# comment\r\n! also\nbad.example\n*.wild.example\n0.0.0.0 hosts.example\n\n")).toEqual([
      "bad.example",
      "wild.example",
      "hosts.example",
    ]);
  });
});

describe("isAllowedSecurityHost", () => {
  it("takes well-formed host names", () => {
    expect(isAllowedSecurityHost("login-verify.example.xyz")).toBe(true);
    expect(isAllowedSecurityHost("xn--80ak6aa92e.com")).toBe(true);
  });

  it("refuses IP addresses and malformed names", () => {
    expect(isAllowedSecurityHost("192.168.1.1")).toBe(false);
    expect(isAllowedSecurityHost("localhost")).toBe(false);
    expect(isAllowedSecurityHost("bad_host.example")).toBe(false);
    expect(isAllowedSecurityHost("-lead.example")).toBe(false);
  });

  it("never lets a list block a protected site or its www.", () => {
    expect(isAllowedSecurityHost("google.com")).toBe(false);
    expect(isAllowedSecurityHost("www.github.com")).toBe(false);
    expect(isAllowedSecurityHost("paypal.com")).toBe(false);
    // Lookalikes are exactly what these lists are for.
    expect(isAllowedSecurityHost("paypal.com.account-check.example")).toBe(true);
    expect(isAllowedSecurityHost("g00gle.com")).toBe(true);
  });
});

describe("cleanSecurityDomains", () => {
  it("lowercases, trims, dedupes, sorts and drops what isn't allowed", () => {
    expect(cleanSecurityDomains(["B.example ", "a.example.", "b.example", "google.com", 42, "1.2.3.4"])).toEqual([
      "a.example",
      "b.example",
    ]);
  });

  it("caps a list", () => {
    const many = Array.from({ length: MAX_LIVE_SECURITY_DOMAINS_PER_GROUP + 10 }, (_, i) => `d${i}.example`);
    expect(cleanSecurityDomains(many)).toHaveLength(MAX_LIVE_SECURITY_DOMAINS_PER_GROUP);
  });
});

describe("parseLiveSecurityPayload", () => {
  it("keeps only known lists, cleaned again", () => {
    const groups = parseLiveSecurityPayload({
      format: LIVE_SECURITY_FORMAT,
      generated: "2026-09-27T00:00:00Z",
      groups: { "phishing-urls": ["Evil.example", "google.com"], scam: ["scam.example"], ads: ["x.example"] },
    });
    expect(groups).toEqual({ "phishing-urls": ["evil.example"], scam: ["scam.example"] });
  });

  it("rejects anything else", () => {
    expect(parseLiveSecurityPayload(null)).toBeNull();
    expect(parseLiveSecurityPayload(["a.example"])).toBeNull();
    expect(parseLiveSecurityPayload({ format: 99, groups: {} })).toBeNull();
    expect(parseLiveSecurityPayload({ format: LIVE_SECURITY_FORMAT, groups: null })).toBeNull();
  });
});

describe("securityChangeNeedsReview", () => {
  const list = (n: number, prefix = "d") => Array.from({ length: n }, (_, i) => `${prefix}${i}.example`);

  it("lets an ordinary day through", () => {
    expect(securityChangeNeedsReview(list(40000), [...list(39000), ...list(1500, "new")])).toBeNull();
    expect(securityChangeNeedsReview([], list(40000))).toBeNull();
  });

  it("stops a list that shrank by more than half", () => {
    expect(securityChangeNeedsReview(list(40000), list(15000))).toMatch(/shrank/);
  });

  it("stops a change bigger than max(5,000, 25%)", () => {
    expect(securityChangeNeedsReview(list(40000), [...list(40000), ...list(10001, "new")])).toMatch(/added/);
    expect(securityChangeNeedsReview(list(1000), [...list(1000), ...list(4000, "new")])).toBeNull();
    expect(securityChangeNeedsReview(list(1000), [...list(1000), ...list(5001, "new")])).toMatch(/added/);
  });
});

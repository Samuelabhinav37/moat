import { describe, expect, it } from "vitest";
import { GA4_COLLECT_REGEX, UA_COLLECT_REGEX, buildServerSideAnalyticsRules } from "./serverSideAnalyticsRules.mjs";

// RE2 (Chrome's DNR regex engine) and JS RegExp agree on this pattern --
// no lookahead, no backreferences -- so testing with JS RegExp here is a
// faithful stand-in for how declarativeNetRequest will actually match.
const ga4 = new RegExp(GA4_COLLECT_REGEX);
const ua = new RegExp(UA_COLLECT_REGEX);

describe("GA4_COLLECT_REGEX", () => {
  it("matches a real GA4 collect beacon, proxied through a first-party domain", () => {
    expect(ga4.test("https://analytics.example-shop.com/g/collect?v=2&tid=G-ABC1234XYZ&cid=555.123")).toBe(true);
  });

  it("matches regardless of param order after the path", () => {
    expect(ga4.test("https://www.google-analytics.com/g/collect?cid=555&tid=G-ABC1234&v=2")).toBe(true);
  });

  it("does not match a bare tid= without the G- prefix", () => {
    expect(ga4.test("https://example.com/g/collect?tid=12345&cid=678")).toBe(false);
  });

  it("does not match an unrelated /g/collect-shaped path with no tid= param", () => {
    expect(ga4.test("https://example.com/g/collect?foo=bar")).toBe(false);
  });

  it("does not match a tid=G- param on an unrelated path", () => {
    expect(ga4.test("https://example.com/other/path?tid=G-ABC1234")).toBe(false);
  });
});

describe("UA_COLLECT_REGEX", () => {
  it("matches a real Universal Analytics collect beacon", () => {
    expect(ua.test("https://stats.example-blog.net/collect?v=1&tid=UA-12345-1&cid=abc")).toBe(true);
  });

  it("does not match a generic tid= param without the UA- prefix", () => {
    expect(ua.test("https://example.com/api/collect?tid=session-42")).toBe(false);
  });

  it("does not match a path that merely contains 'collect' as a substring, not a path segment", () => {
    expect(ua.test("https://example.com/api/mycollect?tid=UA-12345-1")).toBe(false);
  });
});

describe("buildServerSideAnalyticsRules", () => {
  it("builds two block rules with unique ids, scoped to non-navigation resource types", () => {
    const rules = buildServerSideAnalyticsRules();
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((r) => r.id)).size).toBe(2);
    for (const rule of rules) {
      expect(rule.action.type).toBe("block");
      expect(rule.condition.resourceTypes).not.toContain("main_frame");
      expect(rule.condition.resourceTypes).not.toContain("sub_frame");
    }
  });
});

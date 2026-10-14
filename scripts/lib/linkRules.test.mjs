import { describe, expect, it } from "vitest";
import { buildLinkSkipRules, LINK_SKIP_PRIORITY, withoutSharedLinkBlocks } from "./linkRules.mjs";
import { PAUSE_PRIORITY } from "../../src/shared/rulePriorities.ts";

const block = (condition) => ({ id: 1, priority: 1, action: { type: "block" }, condition });

describe("withoutSharedLinkBlocks", () => {
  it("drops a whole-site block of a shared link host", () => {
    expect(withoutSharedLinkBlocks(block({ urlFilter: "||click.pstmrk.it^", resourceTypes: ["main_frame"] }))).toBeNull();
    expect(withoutSharedLinkBlocks(block({ urlFilter: "||t.co^" }))).toBeNull();
  });

  it("keeps one sender's subdomain and a page-level pattern on a shared host", () => {
    const sender = block({ urlFilter: "||u106654694.ct.sendgrid.net^" });
    expect(withoutSharedLinkBlocks(sender)).toBe(sender);
    const page = block({ urlFilter: "||t.co/AbC123" });
    expect(withoutSharedLinkBlocks(page)).toBe(page);
  });

  it("takes shared hosts out of a requestDomains list", () => {
    expect(withoutSharedLinkBlocks(block({ requestDomains: ["a.rs6.net", "evil.example"] })).condition.requestDomains).toEqual(["evil.example"]);
    expect(withoutSharedLinkBlocks(block({ requestDomains: ["a.rs6.net"] }))).toBeNull();
  });
});

describe("buildLinkSkipRules", () => {
  const rules = buildLinkSkipRules(7);
  const skip = (url) => {
    for (const rule of rules.filter((r) => r.action.type === "redirect")) {
      const m = new RegExp(rule.condition.regexFilter).exec(url);
      if (m) return m[1];
    }
    return null;
  };

  it("goes straight to a plain destination from Google's wrapper, on any Google domain", () => {
    expect(skip("https://www.google.com/url?q=https://example.com/page&sa=D&ust=1")).toBe("https://example.com/page");
    expect(skip("https://www.google.co.uk/url?sa=t&url=https://example.com/")).toBe("https://example.com/");
    expect(skip("https://www.google.com.au/url?q=http://example.org")).toBe("http://example.org");
  });

  it("leaves an encoded destination, or a non-address, to the wrapper", () => {
    expect(skip("https://www.google.com/url?q=https%3A%2F%2Fexample.com&sa=D")).toBeNull();
    expect(skip("https://www.google.com/url?q=https://example.com/?a%3D1")).toBeNull();
    expect(skip("https://www.google.com/url?q=running+shoes")).toBeNull();
  });

  it("matches only Google's own hosts", () => {
    expect(skip("https://www.google.com.evil.example/url?q=https://example.com")).toBeNull();
    expect(skip("https://evil.example/www.google.com/url?q=https://example.com")).toBeNull();
  });

  it("handles affiliate wrappers with a plain destination", () => {
    expect(skip("https://click.linksynergy.com/deeplink?id=x&mid=1&murl=https://shop.example/item")).toBe("https://shop.example/item");
    expect(skip("https://www.awin1.com/cread.php?awinmid=1&ued=https://shop.example/")).toBe("https://shop.example/");
  });

  it("redirects only pages, below a pause, and blocks Google's click pings", () => {
    for (const rule of rules.filter((r) => r.action.type === "redirect")) {
      expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
      expect(rule.priority).toBe(LINK_SKIP_PRIORITY);
    }
    expect(LINK_SKIP_PRIORITY).toBeLessThan(PAUSE_PRIORITY);
    expect(rules.find((r) => r.action.type === "block").condition).toEqual({ urlFilter: "|https://www.google.*/gen_204^", resourceTypes: ["ping"] });
    expect(rules.map((r) => r.id)).toEqual(rules.map((_, i) => 7 + i));
  });
});

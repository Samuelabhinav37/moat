import { describe, expect, it } from "vitest";
import { computeAdRules, targetHost } from "./adRules.mjs";

const block = (id, condition) => ({ id, action: { type: "block" }, condition });

describe("targetHost", () => {
  it("reads the host a counted rule stops, however else it's narrowed", () => {
    expect(targetHost(block(1, { urlFilter: "||doubleclick.net^" }))).toBe("doubleclick.net");
    expect(targetHost(block(2, { urlFilter: "||taboola.com^", domainType: "thirdParty" }))).toBe("taboola.com");
    expect(targetHost(block(3, { requestDomains: ["a.com"], resourceTypes: ["script"] }))).toBe("a.com");
    // A redirect to a stub script is counted as a block too.
    expect(
      targetHost({
        id: 4,
        action: { type: "redirect", redirect: { extensionPath: "/stub.js" } },
        condition: { urlFilter: "||securepubads.g.doubleclick.net/tag/js/gpt.js", excludedInitiatorDomains: ["x.com"] },
      })
    ).toBe("securepubads.g.doubleclick.net");
  });

  it("gives nothing for many hosts, regexes, allow rules or other redirects", () => {
    expect(targetHost(block(5, { requestDomains: ["a.com", "b.com"] }))).toBeNull();
    expect(targetHost(block(6, { regexFilter: "^https://a\\.com/" }))).toBeNull();
    expect(targetHost(block(7, { urlFilter: "/ads/banner" }))).toBeNull();
    expect(targetHost({ id: 8, action: { type: "allow" }, condition: { urlFilter: "||a.com^" } })).toBeNull();
    expect(targetHost({ id: 9, action: { type: "redirect", redirect: { url: "https://b.com" } }, condition: { urlFilter: "||a.com^" } })).toBeNull();
  });
});

describe("computeAdRules", () => {
  it("lists rules outside the ads lists that stop an ad server or a subdomain of one", () => {
    const files = {
      "ads.json": [block(1, { urlFilter: "||doubleclick.net^" })],
      "trackers.json": [
        block(10, { urlFilter: "||doubleclick.net^" }),
        block(11, { urlFilter: "||securepubads.g.doubleclick.net/tag/js/gpt.js" }),
        block(12, { urlFilter: "||hotjar.com^" }),
        block(13, { requestDomains: ["doubleclick.net", "hotjar.com"] }),
      ],
    };
    const result = computeAdRules(
      [
        { id: "ruleset_ads-1", group: "ads", file: "ads.json" },
        { id: "ruleset_trackers-1", group: "trackers", file: "trackers.json" },
        // Pop-up and security rules keep their own bucket.
        { id: "ruleset_popups", group: "popups", file: "trackers.json" },
        { id: "ruleset_malicious-urls", group: "malicious-urls", file: "trackers.json" },
      ],
      (file) => files[file],
      new Set(["doubleclick.net"])
    );
    expect(result).toEqual({ "ruleset_trackers-1": [10, 11] });
  });
});

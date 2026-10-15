import { describe, expect, it } from "vitest";
import { buildTrackerCookieRules, KEEP_COOKIES_HOSTS, TRACKER_COOKIE_PRIORITY } from "./trackerCookieRules.mjs";
import { COMPAT_ALLOW_PRIORITY } from "./compatAllowRules.mjs";
import { PAUSE_PRIORITY } from "../../src/shared/rulePriorities.ts";

const psl = { rules: new Set(["com", "net", "co.uk"]), exceptions: new Set() };
const data = {
  cookieblock: ["youtube.com", "maps.google.com", "accounts.google.com", "cdn.example.net", "stripe.com", "widgets.example.co.uk"],
  entities: [["google.com", "youtube.com", "blogger.com"]],
};

describe("buildTrackerCookieRules", () => {
  const { rules, hosts } = buildTrackerCookieRules(data, psl, 10);

  it("strips cookies both ways and never touches a page you open yourself", () => {
    for (const rule of rules) {
      expect(rule.action).toEqual({
        type: "modifyHeaders",
        requestHeaders: [{ header: "cookie", operation: "remove" }],
        responseHeaders: [{ header: "set-cookie", operation: "remove" }],
      });
      expect(rule.condition.domainType).toBe("thirdParty");
      expect(rule.condition.resourceTypes).not.toContain("main_frame");
      expect(rule.condition.resourceTypes).toContain("sub_frame");
    }
  });

  // The rule whose requestDomains list has this exact domain as one of its entries.
  const ruleFor = (domain) => rules.find((r) => r.condition.requestDomains.some((d) => d === domain));

  it("keeps cookies for sign-in and payment hosts", () => {
    expect(hosts).not.toContain("accounts.google.com");
    expect(hosts).not.toContain("stripe.com");
    expect(rules.flatMap((r) => r.condition.requestDomains)).not.toContain("accounts.google.com");
  });

  it("leaves a company's own sites out, so google.com and youtube.com aren't third parties to each other", () => {
    const google = ruleFor("youtube.com");
    expect(google.condition.requestDomains).toEqual(expect.arrayContaining(["youtube.com", "maps.google.com"]));
    expect(google.condition.excludedInitiatorDomains).toEqual(["google.com", "youtube.com", "blogger.com"]);
  });

  it("puts domains without a company group together, with no initiator exclusions", () => {
    const rest = ruleFor("cdn.example.net");
    expect(rest.condition.requestDomains).toEqual(["cdn.example.net", "widgets.example.co.uk"]);
    expect(rest.condition.excludedInitiatorDomains).toBeUndefined();
  });

  it("keeps a sign-in host's cookies even under a stripped parent", () => {
    const { rules: parentRules } = buildTrackerCookieRules({ cookieblock: ["google.com"], entities: [] }, psl);
    expect(parentRules[0].condition.excludedRequestDomains).toEqual(expect.arrayContaining(["accounts.google.com", "docs.google.com"]));
  });

  it("reports the kept hosts under stripped ones, and only the company groups it uses", () => {
    const out = buildTrackerCookieRules({ cookieblock: ["google.com", "cdn.example.net"], entities: [["google.com", "youtube.com"], ["unrelated.com", "unrelated.net"]] }, psl);
    expect(out.keep).toEqual(expect.arrayContaining(["accounts.google.com"]));
    expect(out.entities).toEqual([["google.com", "youtube.com"]]);
  });

  it("also strips a yellowlisted host under a tracker Privacy Badger would block", () => {
    const out = buildTrackerCookieRules({ cookieblock: ["c.com"], entities: [], block: ["tracker.com"], yellowlist: ["fonts.tracker.com", "unrelated.com"] }, psl);
    expect(out.hosts).toEqual(["c.com", "fonts.tracker.com"]);
  });

  it("numbers rules from the id given, below every allowance and pause", () => {
    expect(rules.map((r) => r.id)).toEqual(rules.map((_, i) => 10 + i));
    expect(TRACKER_COOKIE_PRIORITY).toBeLessThan(COMPAT_ALLOW_PRIORITY);
    expect(TRACKER_COOKIE_PRIORITY).toBeLessThan(PAUSE_PRIORITY);
  });

  it("keep list is plain lowercase hosts", () => {
    for (const host of KEEP_COOKIES_HOSTS) expect(host).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
  });
});

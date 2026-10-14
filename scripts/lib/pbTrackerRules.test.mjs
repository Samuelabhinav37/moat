import { describe, expect, it } from "vitest";
import { buildPbTrackerRules, PB_TRACKER_PRIORITY } from "./pbTrackerRules.mjs";
import { KEEP_COOKIES_HOSTS } from "./trackerCookieRules.mjs";
import { PAUSE_PRIORITY } from "../../src/shared/rulePriorities.ts";

const psl = { rules: new Set(["com", "net", "io", "co.uk"]), exceptions: new Set() };
const data = {
  block: ["tracker.com", "ads.example.net", "already.com", "sub.already.com", "fonts-cdn.net", "disqus.com", "auth0.com", "localhost", "pixel.bigco.com", "bigco-cdn.io", "brokenshop-tracker.com"],
  yellowlist: ["fonts-cdn.net", "use.tracker.com"],
  widgetDomains: ["disqus.com", "embed.tracker.com"],
  siteFixes: { "brokenshop-tracker.com": ["www.brokenshop.com"] },
  entities: [["bigco.com", "bigco-cdn.io", "bigco.co.uk"]],
};
const companies = { "tracker.com": "Tracker Inc", "ads.example.net": "Example Ads", "pixel.bigco.com": "BigCo", "bigco-cdn.io": "BigCo" };
const built = buildPbTrackerRules(data, { alreadyBlocked: new Set(["already.com"]), psl, companyOf: (d) => companies[d] ?? null, firstId: 5 });
const ruleFor = (domain) => built.rules.find((r) => r.condition.requestDomains.includes(domain));

describe("buildPbTrackerRules", () => {
  it("blocks only as a third party, never a page you open yourself, below a pause", () => {
    for (const rule of built.rules.filter((r) => r.action.type === "block")) {
      expect(rule.action).toEqual({ type: "block" });
      expect(rule.condition.domainType).toBe("thirdParty");
      expect(rule.condition.resourceTypes).not.toContain("main_frame");
      expect(rule.priority).toBe(PB_TRACKER_PRIORITY);
    }
    expect(PB_TRACKER_PRIORITY).toBeLessThan(PAUSE_PRIORITY);
  });

  it("adds only what Moat doesn't already block, and nothing it keeps working", () => {
    expect(built.domains.sort()).toEqual(["ads.example.net", "bigco-cdn.io", "brokenshop-tracker.com", "pixel.bigco.com", "tracker.com"]);
    expect(built.skipped).toEqual({
      alreadyBlocked: ["already.com", "sub.already.com"],
      yellowlisted: ["fonts-cdn.net"],
      widget: ["disqus.com"],
      keep: ["auth0.com"],
      loopback: ["localhost"],
    });
  });

  it("leaves yellowlisted and widget hosts under a blocked tracker alone", () => {
    expect(ruleFor("tracker.com").condition.excludedRequestDomains).toEqual(["embed.tracker.com", "use.tracker.com"]);
  });

  it("never blocks a company's tracker on its own other sites", () => {
    const rule = ruleFor("pixel.bigco.com");
    expect(rule).toBe(ruleFor("bigco-cdn.io"));
    expect(rule.condition.excludedInitiatorDomains).toEqual(["bigco-cdn.io", "bigco.co.uk", "bigco.com"]);
  });

  it("leaves a tracker alone on the sites where blocking it breaks the page", () => {
    expect(ruleFor("brokenshop-tracker.com").condition.excludedInitiatorDomains).toEqual(["www.brokenshop.com"]);
  });

  it("packs domains with the same exclusions into one rule, numbered from the id given", () => {
    expect(ruleFor("tracker.com")).toBe(ruleFor("ads.example.net"));
    expect(built.rules.map((r) => r.id)).toEqual(built.rules.map((_, i) => 5 + i));
    expect(built.rules).toHaveLength(3);
  });

  it("names a rule's company only when all its domains share one", () => {
    expect(built.companies.get(ruleFor("pixel.bigco.com").id)).toBe("BigCo");
    expect(built.companies.has(ruleFor("tracker.com").id)).toBe(false);
  });

  it("keeps Facebook's login SDK when it blocks facebook.net, and nothing else there", () => {
    const fb = buildPbTrackerRules({ ...data, block: ["facebook.net"] }, { alreadyBlocked: new Set(), psl });
    const allow = fb.rules.find((r) => r.action.type === "allow");
    expect(allow).toMatchObject({ priority: PB_TRACKER_PRIORITY + 1, condition: { urlFilter: "||connect.facebook.net/*/sdk.js", resourceTypes: ["script"] } });
    expect(built.rules.some((r) => r.action.type === "allow")).toBe(false);
  });

  it("never blocks a fraud check a checkout depends on", () => {
    const shop = buildPbTrackerRules({ ...data, block: ["beacon.riskified.com", "sift.com"] }, { alreadyBlocked: new Set(), psl });
    expect(shop.rules).toEqual([]);
    expect(KEEP_COOKIES_HOSTS).toEqual(expect.arrayContaining(["riskified.com", "sift.com"]));
  });
});

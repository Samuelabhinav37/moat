import { describe, expect, it } from "vitest";
import { hostnameOf, isAdCategory, lookupTracker, splitKinds, tallyHosts, type TrackerTable } from "./trackerDomains";

const table: TrackerTable = {
  o: ["Google", "Microsoft"],
  c: ["advertising", "site_analytics"],
  d: { "doubleclick.net": [0, 0], "google-analytics.com": [0, 1], "clarity.ms": [1, 1] },
};

describe("lookupTracker", () => {
  it("finds a domain or any parent of it", () => {
    expect(lookupTracker(table, "securepubads.g.doubleclick.net")).toEqual({ company: "Google", category: "advertising" });
    expect(lookupTracker(table, "WWW.Google-Analytics.com")).toEqual({ company: "Google", category: "site_analytics" });
    expect(lookupTracker(table, "news.example")).toBeNull();
    expect(lookupTracker(null, "clarity.ms")).toBeNull();
  });

  it("treats advertising as ads and everything else as tracking", () => {
    expect(isAdCategory("advertising")).toBe(true);
    expect(isAdCategory("site_analytics")).toBe(false);
  });
});

describe("tallyHosts", () => {
  it("counts blocks by kind, company and purpose, skipping unknown domains", () => {
    const tally = tallyHosts(table, new Map([["stats.g.doubleclick.net", 3], ["www.google-analytics.com", 2], ["c.clarity.ms", 1], ["ads.unknown.example", 9]]));
    expect(tally).toEqual({
      ads: 3,
      trackers: 3,
      companies: { Google: 5, Microsoft: 1 },
      purposes: { advertising: 3, site_analytics: 3 },
    });
  });
});

describe("splitKinds", () => {
  it("uses the domains for trackers when the rule feedback is missing, and leaves nothing unsorted", () => {
    expect(splitKinds(10, { ads: 0, trackers: 0, popups: 0 }, { trackers: 4 })).toEqual({ ads: 6, trackers: 4, popups: 0 });
  });

  it("keeps the rule-based count when it says more, and never goes past the total", () => {
    expect(splitKinds(10, { ads: 2, trackers: 7, popups: 1 }, { trackers: 3 })).toEqual({ ads: 2, trackers: 7, popups: 1 });
    expect(splitKinds(3, { ads: 0, trackers: 0, popups: 1 }, { trackers: 9 })).toEqual({ ads: 0, trackers: 2, popups: 1 });
  });
});

describe("hostnameOf", () => {
  it("reads a URL's hostname and survives junk", () => {
    expect(hostnameOf("https://a.b.example/x?y")).toBe("a.b.example");
    expect(hostnameOf("not a url")).toBe("");
  });
});

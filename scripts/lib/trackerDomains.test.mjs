import { describe, expect, it } from "vitest";
import { buildTrackerDomains } from "./trackerDomains.mjs";

const db = {
  domains: { "doubleclick.net": "dc", "google-analytics.com": "ga", "tiny.example": "tiny", "nocat.example": "nocat" },
  patterns: {
    dc: { name: "DoubleClick", category: "advertising", organization: "google" },
    ga: { name: "Google Analytics", category: "site_analytics", organization: "google" },
    tiny: { name: "Tiny Tracker", category: "site_analytics", organization: null },
    nocat: { name: "No category", organization: "google" },
  },
  organizations: { google: { name: "Google" } },
};

describe("buildTrackerDomains", () => {
  it("maps each domain to its company and purpose, sharing name tables", () => {
    const out = buildTrackerDomains(db);
    const at = (domain) => [out.o[out.d[domain][0]], out.c[out.d[domain][1]]];
    expect(at("doubleclick.net")).toEqual(["Google", "advertising"]);
    expect(at("google-analytics.com")).toEqual(["Google", "site_analytics"]);
    expect(out.o.filter((n) => n === "Google")).toHaveLength(1);
  });

  it("names a tracker with no organization after itself, and skips ones with no purpose", () => {
    const out = buildTrackerDomains(db);
    expect(out.o[out.d["tiny.example"][0]]).toBe("Tiny Tracker");
    expect(out.d["nocat.example"]).toBeUndefined();
  });
});

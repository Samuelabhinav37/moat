import { describe, expect, it } from "vitest";
import { domainChain, extractRuleDomain, lookupCompany, lookupCompanyDetails } from "./ruleCompany.mjs";
import { domainChain as domainChainRuntime } from "../../src/shared/domainChain.ts";

const SAMPLE_DOMAINS = ["example.com", "a.b.c.example.co.uk", "google-analytics.com", ""];

describe("domainChain", () => {
  it("returns every suffix, most specific first, excluding the bare TLD", () => {
    expect(domainChain("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
  });

  it("matches the runtime (TypeScript) copy for every sample domain", () => {
    for (const domain of SAMPLE_DOMAINS) {
      expect(domainChain(domain)).toEqual(domainChainRuntime(domain));
    }
  });
});

describe("extractRuleDomain", () => {
  it("extracts a plain domain-anchored filter", () => {
    expect(extractRuleDomain("||google-analytics.com^")).toBe("google-analytics.com");
  });

  it("extracts the domain from a path-scoped filter", () => {
    expect(extractRuleDomain("||google-analytics.com/analytics.js")).toBe("google-analytics.com");
  });

  it("extracts the domain from a filter with modifiers", () => {
    expect(extractRuleDomain("||google-analytics.com^$third-party")).toBe("google-analytics.com");
  });

  it("lowercases the extracted domain", () => {
    expect(extractRuleDomain("||Example.COM^")).toBe("example.com");
  });

  it("returns null for a filter with no || anchor", () => {
    expect(extractRuleDomain("/some-regex-pattern/")).toBeNull();
  });

  it("returns null for a domain-less anchor", () => {
    expect(extractRuleDomain("||^$third-party")).toBeNull();
  });

  it("returns null for an empty or missing urlFilter", () => {
    expect(extractRuleDomain("")).toBeNull();
    expect(extractRuleDomain(undefined)).toBeNull();
  });
});

describe("lookupCompany", () => {
  const trackerDb = {
    domains: { "google-analytics.com": "ga_pattern", "sub.example.com": "ex_pattern" },
    patterns: {
      ga_pattern: { organization: "google" },
      ex_pattern: { organization: "example_org" },
    },
    organizations: {
      google: { name: "Google LLC" },
      example_org: { name: "Example Org" },
    },
  };

  it("resolves a direct domain match to its organization name", () => {
    expect(lookupCompany("google-analytics.com", trackerDb)).toBe("Google LLC");
  });

  it("walks the domain chain to find a parent-domain match", () => {
    expect(lookupCompany("stats.google-analytics.com", trackerDb)).toBe("Google LLC");
  });

  it("returns null when nothing in the chain matches", () => {
    expect(lookupCompany("unknown-tracker.example", trackerDb)).toBeNull();
  });

  it("returns null when a pattern references a missing organization", () => {
    const broken = { domains: { "x.com": "p" }, patterns: { p: { organization: "missing" } }, organizations: {} };
    expect(lookupCompany("x.com", broken)).toBeNull();
  });
});

describe("lookupCompanyDetails", () => {
  const trackerDb = {
    domains: { "google-analytics.com": "ga_pattern" },
    patterns: { ga_pattern: { organization: "google", category: "site_analytics" } },
    organizations: {
      google: { name: "Google LLC", description: "Search and ads.", website_url: "https://google.com" },
    },
  };

  it("returns name, description, websiteUrl, and category together", () => {
    expect(lookupCompanyDetails("google-analytics.com", trackerDb)).toEqual({
      name: "Google LLC",
      description: "Search and ads.",
      websiteUrl: "https://google.com",
      category: "site_analytics",
    });
  });

  it("returns null fields rather than throwing when TrackerDB data is incomplete", () => {
    const sparse = {
      domains: { "x.com": "p" },
      patterns: { p: { organization: "org" } },
      organizations: { org: { name: "X Org" } },
    };
    expect(lookupCompanyDetails("x.com", sparse)).toEqual({
      name: "X Org",
      description: null,
      websiteUrl: null,
      category: null,
    });
  });

  it("returns null when nothing in the chain matches", () => {
    expect(lookupCompanyDetails("unknown-tracker.example", trackerDb)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { isSecurityGroup, riskTierForGroup, securityMatches } from "./securityRuleCategories";
import type { RulesetManifestEntry } from "./rulesetManifest";

function entry(id: string, group: string): RulesetManifestEntry {
  return { id, group, category: "ads", name: id, enabled: true, file: `${id}.json`, ruleCount: 0 };
}

const MANIFEST: RulesetManifestEntry[] = [
  entry("ruleset_ads-1", "ads"),
  entry("ruleset_malicious-urls", "malicious-urls"),
  entry("ruleset_phishing-urls-1", "phishing-urls"),
  entry("ruleset_scam", "scam"),
  entry("ruleset_badware", "badware"),
];

describe("riskTierForGroup / isSecurityGroup", () => {
  it("tiers the three highest-confidence security lists as high", () => {
    expect(riskTierForGroup("malicious-urls")).toBe("high");
    expect(riskTierForGroup("phishing-urls")).toBe("high");
    expect(riskTierForGroup("scam")).toBe("high");
  });

  it("tiers badware as medium", () => {
    expect(riskTierForGroup("badware")).toBe("medium");
  });

  it("returns null for ordinary ad/tracker/annoyance groups", () => {
    expect(riskTierForGroup("ads")).toBeNull();
    expect(riskTierForGroup("trackers")).toBeNull();
    expect(riskTierForGroup("cookie-notices")).toBeNull();
  });

  it("isSecurityGroup mirrors riskTierForGroup's null-ness", () => {
    expect(isSecurityGroup("scam")).toBe(true);
    expect(isSecurityGroup("ads")).toBe(false);
  });
});

describe("securityMatches", () => {
  it("filters a mixed match list down to only the security-list hits, with their risk tier", () => {
    const matches = [
      { rulesetId: "ruleset_ads-1", ruleId: 1 },
      { rulesetId: "ruleset_malicious-urls", ruleId: 2 },
      { rulesetId: "ruleset_badware", ruleId: 3 },
    ];
    expect(securityMatches(MANIFEST, matches)).toEqual([
      { rulesetId: "ruleset_malicious-urls", ruleId: 2, riskTier: "high" },
      { rulesetId: "ruleset_badware", ruleId: 3, riskTier: "medium" },
    ]);
  });

  it("returns an empty array when nothing matched a security list", () => {
    expect(securityMatches(MANIFEST, [{ rulesetId: "ruleset_ads-1", ruleId: 1 }])).toEqual([]);
  });

  it("ignores a match against a rulesetId the manifest doesn't know about", () => {
    expect(securityMatches(MANIFEST, [{ rulesetId: "unknown", ruleId: 1 }])).toEqual([]);
  });
});

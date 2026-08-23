import { describe, expect, it } from "vitest";
import { summarizeMatchedRules } from "./matchedRuleCategories";
import type { RulesetManifestEntry } from "./rulesetManifest";

function entry(id: string, group: string): RulesetManifestEntry {
  return { id, group, category: "ads", name: id, enabled: true, file: `${id}.json`, ruleCount: 0 };
}

const manifest: RulesetManifestEntry[] = [
  entry("ruleset_ads-1", "ads"),
  entry("ruleset_ads-2", "ads"),
  entry("ruleset_trackers", "trackers"),
  entry("ruleset_url-tracking", "url-tracking"),
  entry("ruleset_popups", "popups"),
  entry("ruleset_malicious-urls", "malicious-urls"),
  entry("ruleset_privacy-headers", "privacy-headers"),
];

describe("summarizeMatchedRules", () => {
  it("buckets chunked ad-list ids together under ads", () => {
    const result = summarizeMatchedRules(manifest, [
      { rulesetId: "ruleset_ads-1" },
      { rulesetId: "ruleset_ads-2" },
    ]);
    expect(result).toEqual({ ads: 2, trackers: 0, popups: 0 });
  });

  it("folds tracking, url-tracking, and malicious-urls into trackers", () => {
    const result = summarizeMatchedRules(manifest, [
      { rulesetId: "ruleset_trackers" },
      { rulesetId: "ruleset_url-tracking" },
      { rulesetId: "ruleset_malicious-urls" },
    ]);
    expect(result).toEqual({ ads: 0, trackers: 3, popups: 0 });
  });

  it("counts the popups group on its own", () => {
    const result = summarizeMatchedRules(manifest, [{ rulesetId: "ruleset_popups" }]);
    expect(result).toEqual({ ads: 0, trackers: 0, popups: 1 });
  });

  it("ignores the core privacy-headers ruleset and unknown ruleset ids", () => {
    const result = summarizeMatchedRules(manifest, [
      { rulesetId: "ruleset_privacy-headers" },
      { rulesetId: "ruleset_does-not-exist" },
    ]);
    expect(result).toEqual({ ads: 0, trackers: 0, popups: 0 });
  });

  it("returns all zeros for no matches", () => {
    expect(summarizeMatchedRules(manifest, [])).toEqual({ ads: 0, trackers: 0, popups: 0 });
  });
});

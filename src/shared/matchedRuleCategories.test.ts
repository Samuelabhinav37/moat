import { describe, expect, it } from "vitest";
import { countedMatches, summarizeMatchedRules, summarizeMatchesByGroup } from "./matchedRuleCategories";
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

  it("counts a tracking-list rule that stops an ad server as an ad, and oisd as ads", () => {
    const withOisd = [...manifest, { id: "ruleset_oisd-1", group: "oisd", category: "ads", name: "oisd", enabled: true, file: "o.json", ruleCount: 1 }];
    const result = summarizeMatchedRules(
      withOisd as typeof manifest,
      [
        { rulesetId: "ruleset_trackers", ruleId: 7 },
        { rulesetId: "ruleset_trackers", ruleId: 8 },
        { rulesetId: "ruleset_oisd-1", ruleId: 1 },
      ],
      { ruleset_trackers: [7] }
    );
    expect(result).toEqual({ ads: 2, trackers: 1, popups: 0 });
  });

  it("counts oisd's tracker ruleset as trackers (GitHub's analytics showed as 130 ads)", () => {
    const withOisd: RulesetManifestEntry[] = [
      ...manifest,
      { ...entry("ruleset_oisd-1", "oisd"), category: "ads" },
      { ...entry("ruleset_oisd-trackers", "oisd"), category: "ads", countAs: "trackers" },
    ];
    const result = summarizeMatchedRules(withOisd, [
      { rulesetId: "ruleset_oisd-1", ruleId: 1 },
      { rulesetId: "ruleset_oisd-trackers", ruleId: 1 },
      { rulesetId: "ruleset_oisd-trackers", ruleId: 1 },
    ]);
    expect(result).toEqual({ ads: 1, trackers: 2, popups: 0 });
    // Still one list in Settings.
    expect(summarizeMatchesByGroup(withOisd, [{ rulesetId: "ruleset_oisd-trackers" }])).toEqual({ oisd: 1 });
  });
});

describe("summarizeMatchesByGroup", () => {
  it("keeps chunked ad-list ids under their shared group, not collapsed into a bucket", () => {
    const result = summarizeMatchesByGroup(manifest, [
      { rulesetId: "ruleset_ads-1" },
      { rulesetId: "ruleset_ads-2" },
      { rulesetId: "ruleset_trackers" },
    ]);
    expect(result).toEqual({ ads: 2, trackers: 1 });
  });

  it("keeps url-tracking and malicious-urls as their own groups, unlike the 3-bucket summary", () => {
    const result = summarizeMatchesByGroup(manifest, [
      { rulesetId: "ruleset_url-tracking" },
      { rulesetId: "ruleset_malicious-urls" },
    ]);
    expect(result).toEqual({ "url-tracking": 1, "malicious-urls": 1 });
  });

  it("ignores unknown ruleset ids", () => {
    expect(summarizeMatchesByGroup(manifest, [{ rulesetId: "ruleset_does-not-exist" }])).toEqual({});
  });

  it("returns an empty object for no matches", () => {
    expect(summarizeMatchesByGroup(manifest, [])).toEqual({});
  });
});

describe("countedMatches", () => {
  const uncounted = { "ruleset_trackers": [339185644], "ruleset_privacy-headers": [1] };

  it("drops non-blocking rules, like the Permissions-Policy header rules every page load matches", () => {
    const result = countedMatches(uncounted, [
      { rulesetId: "ruleset_trackers", ruleId: 339185644 },
      { rulesetId: "ruleset_privacy-headers", ruleId: 1 },
      { rulesetId: "ruleset_trackers", ruleId: 42 },
    ]);
    expect(result).toEqual([{ rulesetId: "ruleset_trackers", ruleId: 42 }]);
  });

  it("only drops the listed id in its own ruleset", () => {
    const result = countedMatches(uncounted, [{ rulesetId: "ruleset_ads-1", ruleId: 1 }]);
    expect(result).toEqual([{ rulesetId: "ruleset_ads-1", ruleId: 1 }]);
  });

  it("keeps matches with no rule id", () => {
    expect(countedMatches(uncounted, [{ rulesetId: "ruleset_trackers" }])).toEqual([{ rulesetId: "ruleset_trackers" }]);
  });
});

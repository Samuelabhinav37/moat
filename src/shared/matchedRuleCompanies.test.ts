import { describe, expect, it } from "vitest";
import { summarizeCompanies, type RuleCompanies } from "./matchedRuleCompanies";

const companies: RuleCompanies = {
  "ruleset_ads-1": { 1001: "Google LLC", 1002: "Meta Platforms" },
  "ruleset_trackers": { 5: "Criteo" },
};

describe("summarizeCompanies", () => {
  it("tallies matches by company name", () => {
    const result = summarizeCompanies(companies, [
      { rulesetId: "ruleset_ads-1", ruleId: 1001 },
      { rulesetId: "ruleset_ads-1", ruleId: 1001 },
      { rulesetId: "ruleset_ads-1", ruleId: 1002 },
      { rulesetId: "ruleset_trackers", ruleId: 5 },
    ]);
    expect(result).toEqual({ "Google LLC": 2, "Meta Platforms": 1, Criteo: 1 });
  });

  it("silently skips matches with no known company", () => {
    const result = summarizeCompanies(companies, [{ rulesetId: "ruleset_ads-1", ruleId: 9999 }]);
    expect(result).toEqual({});
  });

  it("silently skips matches from an unknown ruleset", () => {
    const result = summarizeCompanies(companies, [{ rulesetId: "ruleset_does-not-exist", ruleId: 1 }]);
    expect(result).toEqual({});
  });

  it("skips matches with no ruleId at all", () => {
    const result = summarizeCompanies(companies, [{ rulesetId: "ruleset_ads-1" }]);
    expect(result).toEqual({});
  });

  it("returns an empty object for no matches", () => {
    expect(summarizeCompanies(companies, [])).toEqual({});
  });
});

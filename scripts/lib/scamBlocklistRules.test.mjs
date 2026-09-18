import { describe, expect, it } from "vitest";
import { buildScamBlocklistRules } from "./scamBlocklistRules.mjs";

// Deliberately does not test the no-args (loadScamBlocklistDomains()) path:
// unlike circumventionServiceRules.mjs's curated, git-tracked source file,
// rules/dnr/scam-blocklist-domains.json is a build artifact written by
// update-filters.mjs's own fetch step -- it only exists after
// `npm run filters:update` has actually run, so a test asserting default-load
// behavior would fail on a fresh checkout before that step, unrelated to
// whether this function's own logic is correct.
describe("buildScamBlocklistRules", () => {
  it("builds one block rule per domain, with unique ids", () => {
    const rules = buildScamBlocklistRules(["scam-one.example", "scam-two.example"]);
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((r) => r.id)).size).toBe(2);
  });

  it("blocks via a domain-anchored urlFilter", () => {
    const [rule] = buildScamBlocklistRules(["scam-one.example"]);
    expect(rule.action.type).toBe("block");
    expect(rule.condition.urlFilter).toBe("||scam-one.example^");
  });

  it("includes main_frame -- unlike circumvention-service vendors, a scam domain has no legitimate direct-navigation use case", () => {
    const [rule] = buildScamBlocklistRules(["scam-one.example"]);
    expect(rule.condition.resourceTypes).toContain("main_frame");
    expect(rule.condition.resourceTypes).toContain("sub_frame");
  });

  it("returns an empty array for an empty domain list, not an error", () => {
    expect(buildScamBlocklistRules([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { buildPeterLoweRules } from "./peterLoweRules.mjs";

// Deliberately does not test the no-args (loadPeterLoweDomains()) path --
// same reasoning as scamBlocklistRules.test.mjs: rules/dnr/peter-lowe-domains.json
// is a build artifact written by update-filters.mjs's own fetch step, so it
// only exists after `npm run filters:update` has actually run.
describe("buildPeterLoweRules", () => {
  it("builds one block rule per domain, with unique ids", () => {
    const rules = buildPeterLoweRules(["ad-server-one.example", "ad-server-two.example"]);
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((r) => r.id)).size).toBe(2);
  });

  it("blocks via a domain-anchored urlFilter", () => {
    const [rule] = buildPeterLoweRules(["ad-server-one.example"]);
    expect(rule.action.type).toBe("block");
    expect(rule.condition.urlFilter).toBe("||ad-server-one.example^");
  });

  it("includes main_frame -- an ad-server domain has no legitimate direct-navigation use case", () => {
    const [rule] = buildPeterLoweRules(["ad-server-one.example"]);
    expect(rule.condition.resourceTypes).toContain("main_frame");
    expect(rule.condition.resourceTypes).toContain("sub_frame");
  });

  it("returns an empty array for an empty domain list, not an error", () => {
    expect(buildPeterLoweRules([])).toEqual([]);
  });
});

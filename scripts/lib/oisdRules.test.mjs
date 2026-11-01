import { describe, expect, it } from "vitest";
import { buildOisdRules, parseOisdList } from "./oisdRules.mjs";

// Deliberately does not test the no-args (loadOisdDomains()) path -- same
// reasoning as scamBlocklistRules.test.mjs: rules/dnr/oisd-domains.json is a
// build artifact written by update-filters.mjs's own fetch step, so it only
// exists after `npm run filters:update` has actually run.
describe("buildOisdRules", () => {
  it("builds one block rule per domain, with unique ids", () => {
    const rules = buildOisdRules(["bad-one.example", "bad-two.example"]);
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((r) => r.id)).size).toBe(2);
  });

  it("blocks via a domain-anchored urlFilter", () => {
    const [rule] = buildOisdRules(["bad-one.example"]);
    expect(rule.action.type).toBe("block");
    expect(rule.condition.urlFilter).toBe("||bad-one.example^");
  });

  it("never blocks a page you open yourself, only what pages load (frames included)", () => {
    const [rule] = buildOisdRules(["bad-one.example"]);
    expect(rule.condition.resourceTypes).not.toContain("main_frame");
    expect(rule.condition.resourceTypes).toContain("sub_frame");
  });

  it("returns an empty array for an empty domain list, not an error", () => {
    expect(buildOisdRules([])).toEqual([]);
  });
});

describe("parseOisdList", () => {
  it("keeps only plain ||domain^ lines, lowercased, deduped and sorted", () => {
    const text = ["# Title: oisd small", "||B.example^", "||a.example^ ", "||a.example^", "@@||ok.example^", "||c.example^$third-party", "||1.2^"].join("\n");
    expect(parseOisdList(text)).toEqual(["a.example", "b.example"]);
  });
});

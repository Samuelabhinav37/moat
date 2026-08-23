import { describe, expect, it } from "vitest";
import {
  allLiveDynamicRuleIds,
  buildDynamicRedirectRules,
  LIVE_DYNAMIC_RULE_ID_START,
  MAX_LIVE_DYNAMIC_RULES,
} from "./liveRedirectRules";

describe("buildDynamicRedirectRules", () => {
  it("builds one block rule per domain", () => {
    const rules = buildDynamicRedirectRules(["a.com", "b.com"]);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      id: LIVE_DYNAMIC_RULE_ID_START,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: "||a.com^", resourceTypes: ["main_frame"] },
    });
    expect(rules[1]?.id).toBe(LIVE_DYNAMIC_RULE_ID_START + 1);
  });

  it("only blocks main_frame requests, not every resource type", () => {
    const rules = buildDynamicRedirectRules(["a.com"]);
    expect(rules[0]?.condition.resourceTypes).toEqual(["main_frame"]);
  });

  it("assigns unique, sequential ids with no gaps", () => {
    const rules = buildDynamicRedirectRules(["a.com", "b.com", "c.com"]);
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([LIVE_DYNAMIC_RULE_ID_START, LIVE_DYNAMIC_RULE_ID_START + 1, LIVE_DYNAMIC_RULE_ID_START + 2]);
  });

  it("caps at MAX_LIVE_DYNAMIC_RULES rather than exceeding the dynamic-rule budget", () => {
    const domains = Array.from({ length: MAX_LIVE_DYNAMIC_RULES + 500 }, (_, i) => `d${i}.com`);
    const rules = buildDynamicRedirectRules(domains);
    expect(rules).toHaveLength(MAX_LIVE_DYNAMIC_RULES);
  });

  it("returns an empty array for an empty domain list", () => {
    expect(buildDynamicRedirectRules([])).toEqual([]);
  });
});

describe("allLiveDynamicRuleIds", () => {
  it("covers exactly the id range buildDynamicRedirectRules can produce", () => {
    const ids = allLiveDynamicRuleIds();
    expect(ids).toHaveLength(MAX_LIVE_DYNAMIC_RULES);
    expect(ids[0]).toBe(LIVE_DYNAMIC_RULE_ID_START);
    expect(ids[ids.length - 1]).toBe(LIVE_DYNAMIC_RULE_ID_START + MAX_LIVE_DYNAMIC_RULES - 1);

    const maxDomains = Array.from({ length: MAX_LIVE_DYNAMIC_RULES }, (_, i) => `d${i}.com`);
    const builtIds = buildDynamicRedirectRules(maxDomains).map((r) => r.id);
    expect(new Set(ids)).toEqual(new Set(builtIds));
  });
});

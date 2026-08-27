import { describe, expect, it } from "vitest";
import {
  allCustomAllowRuleIds,
  allCustomBlockRuleIds,
  buildCustomAllowRules,
  buildCustomBlockRules,
  CUSTOM_ALLOW_ID_START,
  CUSTOM_BLOCK_ID_START,
  MAX_CUSTOM_RULES_PER_LIST,
} from "./customRules";

describe("buildCustomBlockRules", () => {
  it("builds one block rule per domain covering every resource type", () => {
    const rules = buildCustomBlockRules(["a.com"]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.action).toEqual({ type: "block" });
    expect(rules[0]?.condition.urlFilter).toBe("||a.com^");
    expect(rules[0]?.condition.resourceTypes).toContain("main_frame");
    expect(rules[0]?.condition.resourceTypes).toContain("xmlhttprequest");
  });

  it("assigns ids starting at CUSTOM_BLOCK_ID_START", () => {
    const rules = buildCustomBlockRules(["a.com", "b.com"]);
    expect(rules.map((r) => r.id)).toEqual([CUSTOM_BLOCK_ID_START, CUSTOM_BLOCK_ID_START + 1]);
  });

  it("caps at MAX_CUSTOM_RULES_PER_LIST", () => {
    const domains = Array.from({ length: MAX_CUSTOM_RULES_PER_LIST + 10 }, (_, i) => `d${i}.com`);
    expect(buildCustomBlockRules(domains)).toHaveLength(MAX_CUSTOM_RULES_PER_LIST);
  });

  it("skips a malformed entry instead of letting it break the whole batch", () => {
    const rules = buildCustomBlockRules(["a.com", "not a domain", "https://b.com/path", "", "c.com"]);
    expect(rules.map((r) => r.condition.urlFilter)).toEqual(["||a.com^", "||c.com^"]);
  });

  it("still rejects a domain with a port, path, or credentials attached", () => {
    const rules = buildCustomBlockRules(["example.com:8080", "example.com/path", "user@example.com"]);
    expect(rules).toHaveLength(0);
  });

  it("converts an internationalized domain to its punycode form instead of dropping it", () => {
    const rules = buildCustomBlockRules(["münchen.de"]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.condition.urlFilter).toBe("||xn--mnchen-3ya.de^");
  });
});

describe("buildCustomAllowRules", () => {
  it("builds an allow rule with higher priority than a block rule, so it wins", () => {
    const [blockRule] = buildCustomBlockRules(["a.com"]);
    const [allowRule] = buildCustomAllowRules(["a.com"]);
    expect(allowRule?.action).toEqual({ type: "allow" });
    expect(allowRule!.priority!).toBeGreaterThan(blockRule!.priority!);
  });

  it("uses a completely separate id range from block rules", () => {
    const blockIds = new Set(buildCustomBlockRules(["a.com"]).map((r) => r.id));
    const allowIds = new Set(buildCustomAllowRules(["a.com"]).map((r) => r.id));
    for (const id of allowIds) expect(blockIds.has(id)).toBe(false);
  });
});

describe("id range helpers", () => {
  it("allCustomBlockRuleIds covers exactly what buildCustomBlockRules can produce at the cap", () => {
    const domains = Array.from({ length: MAX_CUSTOM_RULES_PER_LIST }, (_, i) => `d${i}.com`);
    const builtIds = new Set(buildCustomBlockRules(domains).map((r) => r.id));
    expect(new Set(allCustomBlockRuleIds())).toEqual(builtIds);
  });

  it("allCustomAllowRuleIds does not overlap allCustomBlockRuleIds", () => {
    const blockIds = new Set(allCustomBlockRuleIds());
    const allowIds = new Set(allCustomAllowRuleIds());
    expect(CUSTOM_ALLOW_ID_START).toBeGreaterThanOrEqual(CUSTOM_BLOCK_ID_START + MAX_CUSTOM_RULES_PER_LIST);
    for (const id of allowIds) expect(blockIds.has(id)).toBe(false);
  });
});

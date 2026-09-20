import { describe, expect, it } from "vitest";
import { consolidateSiblingRules } from "./consolidateSiblingRules.mjs";

const RESOURCE_TYPES = ["script", "xmlhttprequest"];

function blockRule(id, urlFilter, resourceTypes = RESOURCE_TYPES) {
  return { id, priority: 1, action: { type: "block" }, condition: { urlFilter, resourceTypes } };
}

describe("consolidateSiblingRules", () => {
  it("collapses multiple sibling subdomains of an allowlisted domain into one apex rule", () => {
    const rules = [
      blockRule(1, "||a.example.com^"),
      blockRule(2, "||b.example.com^"),
      blockRule(3, "||c.example.com^"),
    ];
    const { kept, consolidatedCount } = consolidateSiblingRules(rules, new Set(["example.com"]));
    expect(kept).toHaveLength(1);
    expect(kept[0].condition.urlFilter).toBe("||example.com^");
    expect(consolidatedCount).toBe(2);
  });

  it("reuses the first matching rule's id and priority for the apex rule", () => {
    const rules = [blockRule(7, "||a.example.com^"), blockRule(8, "||b.example.com^")];
    const { kept } = consolidateSiblingRules(rules, new Set(["example.com"]));
    expect(kept[0].id).toBe(7);
    expect(kept[0].priority).toBe(1);
  });

  it("keeps a single group per distinct resourceTypes set, never merging across them", () => {
    const rules = [
      blockRule(1, "||a.example.com^", ["script"]),
      blockRule(2, "||b.example.com^", ["image"]),
    ];
    const { kept, consolidatedCount } = consolidateSiblingRules(rules, new Set(["example.com"]));
    expect(kept).toHaveLength(2);
    expect(consolidatedCount).toBe(0);
    expect(kept.map((r) => r.condition.resourceTypes)).toEqual(
      expect.arrayContaining([["script"], ["image"]])
    );
  });

  it("leaves rules for non-allowlisted domains completely untouched", () => {
    const rules = [blockRule(1, "||a.other.com^"), blockRule(2, "||b.other.com^")];
    const { kept, consolidatedCount } = consolidateSiblingRules(rules, new Set(["example.com"]));
    expect(kept).toEqual(rules);
    expect(consolidatedCount).toBe(0);
  });

  it("never touches a rule for the allowlisted domain's own apex (not a subdomain of itself)", () => {
    const rules = [blockRule(1, "||example.com^"), blockRule(2, "||sub.example.com^")];
    const { kept, consolidatedCount } = consolidateSiblingRules(rules, new Set(["example.com"]));
    // The apex rule (id 1) is untouched; the one real sibling (id 2) still
    // gets folded into its own apex rule, independent of rule 1 already
    // existing -- this module doesn't dedupe against a pre-existing apex
    // rule (pruneRedundantRules already handles that redundancy separately).
    expect(kept).toHaveLength(2);
    expect(consolidatedCount).toBe(0);
  });

  it("never merges a rule with extra condition fields (initiatorDomains etc.)", () => {
    const complex = {
      id: 1,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: "||a.example.com^", resourceTypes: RESOURCE_TYPES, initiatorDomains: ["site.com"] },
    };
    const { kept, consolidatedCount } = consolidateSiblingRules([complex], new Set(["example.com"]));
    expect(kept).toEqual([complex]);
    expect(consolidatedCount).toBe(0);
  });

  it("only ever touches domains in the allowlist even when many groups exist", () => {
    const rules = [
      blockRule(1, "||a.example.com^"),
      blockRule(2, "||b.example.com^"),
      blockRule(3, "||a.other.com^"),
      blockRule(4, "||b.other.com^"),
    ];
    const { kept, consolidatedCount } = consolidateSiblingRules(rules, new Set(["example.com"]));
    expect(kept).toHaveLength(3); // 1 apex for example.com + the 2 untouched other.com rules
    expect(consolidatedCount).toBe(1);
    expect(kept.some((r) => r.condition.urlFilter === "||other.com^")).toBe(false);
  });

  it("handles a single sibling the same as many -- still collapses to an apex rule", () => {
    const rules = [blockRule(1, "||only.example.com^")];
    const { kept, consolidatedCount } = consolidateSiblingRules(rules, new Set(["example.com"]));
    expect(kept).toEqual([{ ...rules[0], condition: { ...rules[0].condition, urlFilter: "||example.com^" } }]);
    expect(consolidatedCount).toBe(0);
  });
});

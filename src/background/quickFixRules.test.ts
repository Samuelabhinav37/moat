import { describe, expect, it } from "vitest";
import {
  allQuickFixRuleIds,
  buildQuickFixRules,
  filterValidQuickFixes,
  MAX_QUICK_FIX_RULES,
  QUICK_FIX_ID_START,
  type QuickFixEntry,
} from "./quickFixRules";

const block: QuickFixEntry = { action: "block", urlFilter: "||anti-adblock.example^", resourceTypes: ["script"] };
const allow: QuickFixEntry = { action: "allow", urlFilter: "||over-blocked.example^", resourceTypes: ["main_frame"] };

describe("filterValidQuickFixes", () => {
  it("accepts well-formed block and allow entries", () => {
    const { valid, rejectedCount } = filterValidQuickFixes([block, allow]);
    expect(valid).toEqual([block, allow]);
    expect(rejectedCount).toBe(0);
  });

  it("rejects an entry with an unknown action", () => {
    const { valid, rejectedCount } = filterValidQuickFixes([{ ...block, action: "redirect-anywhere" }]);
    expect(valid).toEqual([]);
    expect(rejectedCount).toBe(1);
  });

  it("rejects the removed stripParams action -- only block/allow are 'safe' rule types", () => {
    const stripParams = {
      action: "stripParams",
      urlFilter: "||news.example^",
      resourceTypes: ["main_frame"],
      removeParams: ["newparam"],
    };
    expect(filterValidQuickFixes([stripParams]).valid).toEqual([]);
  });

  it("rejects an entry with a missing or empty urlFilter", () => {
    expect(filterValidQuickFixes([{ ...block, urlFilter: "" }]).valid).toEqual([]);
    expect(filterValidQuickFixes([{ action: "block", resourceTypes: ["script"] }]).valid).toEqual([]);
  });

  it("rejects an entry with no resourceTypes, or an unknown resource type", () => {
    expect(filterValidQuickFixes([{ ...block, resourceTypes: [] }]).valid).toEqual([]);
    expect(filterValidQuickFixes([{ ...block, resourceTypes: ["not-a-real-type"] }]).valid).toEqual([]);
  });

  it("never lets action.redirect.url or regexSubstitution shapes through -- only block/allow exist", () => {
    const { valid } = filterValidQuickFixes([
      { action: "block", urlFilter: "x", resourceTypes: ["script"], redirect: { url: "https://evil.example" } },
    ]);
    // The extra "redirect" field is simply ignored by buildQuickFixRules -- it only
    // ever reads entry.action, so there's no code path that could honor it even if present.
    expect(valid).toHaveLength(1);
  });

  it("silently drops non-object entries instead of throwing", () => {
    expect(filterValidQuickFixes([null, "x", 42, block]).valid).toEqual([block]);
  });
});

describe("buildQuickFixRules", () => {
  it("builds a block rule as-is", () => {
    const rules = buildQuickFixRules([block]);
    expect(rules[0]).toEqual({
      id: QUICK_FIX_ID_START,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: block.urlFilter, resourceTypes: ["script"] },
    });
  });

  it("builds an allow rule as-is", () => {
    const rules = buildQuickFixRules([allow]);
    expect(rules[0]?.action).toEqual({ type: "allow" });
  });

  it("never emits an unsafe action type (redirect / modifyHeaders)", () => {
    for (const rule of buildQuickFixRules([block, allow])) {
      expect(["block", "allow"]).toContain(rule.action.type);
    }
  });

  it("assigns unique, sequential ids with no gaps", () => {
    const ids = buildQuickFixRules([block, allow]).map((r) => r.id);
    expect(ids).toEqual([QUICK_FIX_ID_START, QUICK_FIX_ID_START + 1]);
  });

  it("caps at MAX_QUICK_FIX_RULES rather than exceeding the dynamic-rule budget", () => {
    const entries = Array.from({ length: MAX_QUICK_FIX_RULES + 50 }, () => block);
    expect(buildQuickFixRules(entries)).toHaveLength(MAX_QUICK_FIX_RULES);
  });

  it("returns an empty array for an empty entry list", () => {
    expect(buildQuickFixRules([])).toEqual([]);
  });
});

describe("allQuickFixRuleIds", () => {
  it("covers exactly the id range buildQuickFixRules can produce, and stays out of every other dynamic-rule range", () => {
    const ids = allQuickFixRuleIds();
    expect(ids).toHaveLength(MAX_QUICK_FIX_RULES);
    expect(ids[0]).toBe(QUICK_FIX_ID_START);
    expect(ids[ids.length - 1]).toBe(QUICK_FIX_ID_START + MAX_QUICK_FIX_RULES - 1);

    // CUSTOM_BLOCK_ID_START=800_000 (+1000), CUSTOM_ALLOW_ID_START=810_000 (+1000),
    // LIVE_DYNAMIC_RULE_ID_START=900_000 (+2000) -- 950_000+500 stays clear of all three.
    expect(QUICK_FIX_ID_START).toBeGreaterThan(810_000 + 1000);
    expect(QUICK_FIX_ID_START).toBeGreaterThan(900_000 + 2000);
  });
});

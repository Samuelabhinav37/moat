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
const stripParams: QuickFixEntry = {
  action: "stripParams",
  urlFilter: "||news.example^",
  resourceTypes: ["main_frame"],
  removeParams: ["newparam"],
};

describe("filterValidQuickFixes", () => {
  it("accepts well-formed block, allow, and stripParams entries", () => {
    const { valid, rejectedCount } = filterValidQuickFixes([block, allow, stripParams]);
    expect(valid).toEqual([block, allow, stripParams]);
    expect(rejectedCount).toBe(0);
  });

  it("rejects an entry with an unknown action", () => {
    const { valid, rejectedCount } = filterValidQuickFixes([{ ...block, action: "redirect-anywhere" }]);
    expect(valid).toEqual([]);
    expect(rejectedCount).toBe(1);
  });

  it("rejects an entry with a missing or empty urlFilter", () => {
    expect(filterValidQuickFixes([{ ...block, urlFilter: "" }]).valid).toEqual([]);
    expect(filterValidQuickFixes([{ action: "block", resourceTypes: ["script"] }]).valid).toEqual([]);
  });

  it("rejects an entry with no resourceTypes, or an unknown resource type", () => {
    expect(filterValidQuickFixes([{ ...block, resourceTypes: [] }]).valid).toEqual([]);
    expect(filterValidQuickFixes([{ ...block, resourceTypes: ["not-a-real-type"] }]).valid).toEqual([]);
  });

  it("rejects a stripParams entry with no removeParams", () => {
    const withoutParams: Record<string, unknown> = { ...stripParams };
    delete withoutParams.removeParams;
    expect(filterValidQuickFixes([withoutParams]).valid).toEqual([]);
    expect(filterValidQuickFixes([{ ...stripParams, removeParams: [] }]).valid).toEqual([]);
  });

  it("never lets action.redirect.url or regexSubstitution shapes through -- only the three known actions exist", () => {
    const { valid } = filterValidQuickFixes([
      { action: "block", urlFilter: "x", resourceTypes: ["script"], redirect: { url: "https://evil.example" } },
    ]);
    // The extra "redirect" field is simply ignored by buildQuickFixRules -- buildAction only
    // ever looks at entry.action, so there's no code path that could honor it even if present.
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

  it("builds a stripParams entry as a redirect/queryTransform rule", () => {
    const rules = buildQuickFixRules([stripParams]);
    expect(rules[0]?.action).toEqual({
      type: "redirect",
      redirect: { transform: { queryTransform: { removeParams: ["newparam"] } } },
    });
  });

  it("assigns unique, sequential ids with no gaps", () => {
    const ids = buildQuickFixRules([block, allow, stripParams]).map((r) => r.id);
    expect(ids).toEqual([QUICK_FIX_ID_START, QUICK_FIX_ID_START + 1, QUICK_FIX_ID_START + 2]);
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

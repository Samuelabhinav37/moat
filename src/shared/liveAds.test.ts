import { describe, expect, it } from "vitest";
import { LIVE_AD_ID_START, MAX_LIVE_AD_DAILY_ADDS, adChangeNeedsReview, isLiveAdRule } from "./liveAds";
import { summarizeMatchedRules } from "./matchedRuleCategories";

describe("adChangeNeedsReview", () => {
  it("lets small days and shrinking (a release took them in) through", () => {
    expect(adChangeNeedsReview(["a.example"], ["a.example", "b.example"])).toBeNull();
    expect(adChangeNeedsReview(["a.example", "b.example"], [])).toBeNull();
  });

  it("holds a day that adds too much", () => {
    const many = Array.from({ length: MAX_LIVE_AD_DAILY_ADDS + 1 }, (_, i) => `d${i}.example`);
    expect(adChangeNeedsReview([], many)).toMatch(/added/);
  });
});

describe("counting", () => {
  it("counts a daily ad rule's blocks as ads in the popup", () => {
    expect(isLiveAdRule("_dynamic", LIVE_AD_ID_START)).toBe(true);
    expect(isLiveAdRule("_dynamic", LIVE_AD_ID_START - 1)).toBe(false);
    expect(summarizeMatchedRules([], [{ rulesetId: "_dynamic", ruleId: LIVE_AD_ID_START }, { rulesetId: "_dynamic", ruleId: 1 }])).toEqual({ ads: 1, trackers: 0, popups: 0 });
  });
});

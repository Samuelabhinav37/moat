import { describe, expect, it, vi } from "vitest";
import { ENTERPRISE_PRIORITY, SECURITY_PRIORITY_OFFSET } from "../shared/rulePriorities";

vi.mock("webextension-polyfill", () => ({ default: {} }));
const { MAX_PROCEED_RULES, PROCEED_ID_START, buildProceedRule, nextProceedId } = await import("./proceedRules");

describe("Open anyway rule", () => {
  it("allows the site's own requests, the page itself included", () => {
    const rule = buildProceedRule(PROCEED_ID_START, "bad.example");
    expect(rule.action.type).toBe("allow");
    expect(rule.condition.requestDomains).toEqual(["bad.example"]);
    // A rule with no resourceTypes skips main_frame, and the page stays blocked.
    expect(rule.condition.resourceTypes).toContain("main_frame");
  });

  it("sits above every security list and below an organization's policy", () => {
    const { priority } = buildProceedRule(PROCEED_ID_START, "bad.example");
    expect(priority).toBeGreaterThan(SECURITY_PRIORITY_OFFSET + 1_200_000);
    expect(priority).toBeLessThan(ENTERPRISE_PRIORITY);
  });

  it("takes the first free id, and none when every slot is used", () => {
    expect(nextProceedId([])).toBe(PROCEED_ID_START);
    expect(nextProceedId([buildProceedRule(PROCEED_ID_START, "a.example"), { ...buildProceedRule(5, "x.example") }])).toBe(PROCEED_ID_START + 1);
    const full = Array.from({ length: MAX_PROCEED_RULES }, (_, i) => buildProceedRule(PROCEED_ID_START + i, "a.example"));
    expect(nextProceedId(full)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildCircumventionServiceRules, loadCircumventionServiceDomains } from "./circumventionServiceRules.mjs";

describe("loadCircumventionServiceDomains", () => {
  it("reads a non-empty, sorted, deduplicated curated list", () => {
    const domains = loadCircumventionServiceDomains();
    expect(domains.length).toBeGreaterThan(0);
    expect(new Set(domains).size).toBe(domains.length);
    expect([...domains].sort()).toEqual(domains);
  });

  it("includes the two confirmed circumvention-service vendors from this session's audit", () => {
    const domains = loadCircumventionServiceDomains();
    expect(domains).toContain("addefend.com");
    expect(domains).toContain("adthrive.com");
  });
});

describe("buildCircumventionServiceRules", () => {
  it("builds one block rule per domain, with unique ids", () => {
    const rules = buildCircumventionServiceRules(["addefend.com", "adthrive.com"]);
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((r) => r.id)).size).toBe(2);
  });

  it("blocks via a domain-anchored urlFilter, scoped to non-navigation resource types", () => {
    const [rule] = buildCircumventionServiceRules(["addefend.com"]);
    expect(rule.action.type).toBe("block");
    expect(rule.condition.urlFilter).toBe("||addefend.com^");
    expect(rule.condition.resourceTypes).not.toContain("main_frame");
  });

  it("leaves a direct navigation to the vendor's own site unblocked (sub_frame still allowed to resolve as content)", () => {
    // main_frame exclusion is the load-bearing part of this test -- a user
    // typing addefend.com into the address bar should still resolve, same
    // reasoning as update-filters.mjs's ownTrackerRules.
    const [rule] = buildCircumventionServiceRules(["addefend.com"]);
    expect(rule.condition.resourceTypes).not.toContain("main_frame");
  });

  it("defaults to loading the curated rules/circumvention-services.json when called with no args", () => {
    const rules = buildCircumventionServiceRules();
    expect(rules.length).toBeGreaterThan(0);
  });
});

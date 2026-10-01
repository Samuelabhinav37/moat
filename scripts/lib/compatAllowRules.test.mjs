import { describe, expect, it } from "vitest";
import { buildCompatAllowRules, COMPAT_ALLOW_PRIORITY, COMPAT_ALLOW_URL_FILTERS } from "./compatAllowRules.mjs";
import { BUNDLED_NON_SECURITY_MAX_PRIORITY, NEVER_BLOCK_PRIORITY, SECURITY_PRIORITY_OFFSET } from "../../src/shared/rulePriorities.ts";

describe("buildCompatAllowRules", () => {
  const rules = buildCompatAllowRules(100);

  it("makes one allow rule per filter, ids from the first id up", () => {
    expect(rules).toHaveLength(COMPAT_ALLOW_URL_FILTERS.length);
    expect(rules.map((r) => r.id)).toEqual(COMPAT_ALLOW_URL_FILTERS.map((_, i) => 100 + i));
    for (const rule of rules) expect(rule.action).toEqual({ type: "allow" });
  });

  it("sits above bundled ad/tracker rules and below Never block and the security lists", () => {
    expect(COMPAT_ALLOW_PRIORITY).toBeLessThanOrEqual(BUNDLED_NON_SECURITY_MAX_PRIORITY);
    expect(COMPAT_ALLOW_PRIORITY).toBeGreaterThan(1_100_201);
    expect(COMPAT_ALLOW_PRIORITY).toBeLessThan(NEVER_BLOCK_PRIORITY);
    expect(COMPAT_ALLOW_PRIORITY).toBeLessThan(SECURITY_PRIORITY_OFFSET);
  });

  it("never allows a top-level page load (main_frame)", () => {
    for (const rule of rules) expect(rule.condition.resourceTypes).not.toContain("main_frame");
  });

  it("scopes Google to its CAPTCHA and sign-in paths, not whole domains", () => {
    const google = COMPAT_ALLOW_URL_FILTERS.filter((f) => /google|gstatic/.test(f));
    expect(google.every((f) => f.endsWith("/"))).toBe(true);
  });
});

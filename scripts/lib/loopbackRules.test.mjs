import { describe, expect, it } from "vitest";
import { buildLoopbackRules, LOOPBACK_PRIORITY } from "./loopbackRules.mjs";
import { BUNDLED_NON_SECURITY_MAX_PRIORITY, NEVER_BLOCK_PRIORITY, PAUSE_PRIORITY } from "../../src/shared/rulePriorities.ts";

describe("buildLoopbackRules", () => {
  const rules = buildLoopbackRules(200);

  it("allows requests to loopback and everything a loopback page loads", () => {
    expect(rules.map((r) => r.action.type)).toEqual(["allow", "allowAllRequests"]);
    for (const rule of rules) expect(rule.condition.requestDomains).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    expect(rules[1].condition.resourceTypes).toEqual(["main_frame", "sub_frame"]);
  });

  it("uses consecutive ids from the one given", () => {
    expect(rules.map((r) => r.id)).toEqual([200, 201]);
  });

  it("sits above bundled rules but below Never block and pause", () => {
    expect(LOOPBACK_PRIORITY).toBeLessThanOrEqual(BUNDLED_NON_SECURITY_MAX_PRIORITY);
    expect(LOOPBACK_PRIORITY).toBeLessThan(NEVER_BLOCK_PRIORITY);
    expect(LOOPBACK_PRIORITY).toBeLessThan(PAUSE_PRIORITY);
    for (const rule of rules) expect(rule.priority).toBe(LOOPBACK_PRIORITY);
  });
});

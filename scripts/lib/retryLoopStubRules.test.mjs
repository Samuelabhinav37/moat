import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { buildRetryLoopStubRules, isRetryLoopStubRule, RETRY_LOOP_STUBS, retryLoopStubResources } from "./retryLoopStubRules.mjs";

describe("buildRetryLoopStubRules", () => {
  it("redirects each stub to its bundled empty resource, above plain blocks", () => {
    const [rule] = buildRetryLoopStubRules();
    expect(rule).toEqual({
      id: 1,
      priority: 1001,
      action: { type: "redirect", redirect: { extensionPath: "/web-accessible-resources/redirects/noopjson.json" } },
      condition: { urlFilter: "||cdn-media.brightline.tv/config/", resourceTypes: ["xmlhttprequest"], initiatorDomains: ["cnn.com"] },
    });
  });

  it("is the only kind of fetch stand-in allowed, and only as built", () => {
    const [rule] = buildRetryLoopStubRules();
    expect(isRetryLoopStubRule(rule)).toBe(true);
    expect(isRetryLoopStubRule({ ...rule, condition: { ...rule.condition, initiatorDomains: undefined } })).toBe(false);
    expect(isRetryLoopStubRule({ ...rule, condition: { ...rule.condition, initiatorDomains: ["cnn.com", "evil.example"] } })).toBe(false);
  });

  it("gives every rule a unique id", () => {
    const ids = buildRetryLoopStubRules().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses resources that @adguard/scriptlets ships", () => {
    for (const name of retryLoopStubResources()) {
      expect(existsSync(`node_modules/@adguard/scriptlets/dist/redirect-files/${name}`), name).toBe(true);
    }
    expect(RETRY_LOOP_STUBS.length).toBeGreaterThan(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};
const updateDynamicRules = vi.fn(async () => {});
let enabledRulesets: string[] = [];
vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
    },
    declarativeNetRequest: {
      getEnabledRulesets: vi.fn(async () => enabledRulesets),
      updateDynamicRules,
    },
  },
}));
vi.mock("./rulesetManifestLoader", () => ({
  loadRulesetManifest: vi.fn(async () => [
    { id: "ruleset_phishing-urls-1", group: "phishing-urls" },
    { id: "ruleset_phishing-urls-2", group: "phishing-urls" },
    { id: "ruleset_scam", group: "scam" },
    { id: "ruleset_malicious-urls", group: "malicious-urls" },
    { id: "ruleset_ads-1", group: "ads" },
  ]),
}));

const {
  LIVE_SECURITY_ID_START,
  LIVE_SECURITY_PRIORITY,
  MAX_LIVE_SECURITY_RULES,
  allLiveSecurityRuleIds,
  applyLiveSecurityRules,
  buildLiveSecurityRules,
  storeLiveSecurityPayload,
} = await import("./liveSecurityRules");
const { BUNDLED_NON_SECURITY_MAX_PRIORITY, ENTERPRISE_PRIORITY, PAUSE_PRIORITY, SECURITY_PRIORITY_OFFSET } = await import(
  "../shared/rulePriorities"
);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  updateDynamicRules.mockClear();
  enabledRulesets = [];
});

describe("buildLiveSecurityRules", () => {
  it("packs each switched-on list into block rules at the bundled lists' priority, page loads included", () => {
    const rules = buildLiveSecurityRules(
      { "phishing-urls": ["a.example", "b.example"], scam: ["s.example"] },
      new Set(["phishing-urls", "scam"])
    );
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      id: LIVE_SECURITY_ID_START,
      priority: LIVE_SECURITY_PRIORITY,
      action: { type: "block" },
      condition: { requestDomains: ["a.example", "b.example"] },
    });
    expect(rules[0]!.condition.resourceTypes).toContain("main_frame");
    expect(rules[1]!.condition.requestDomains).toEqual(["s.example"]);
  });

  it("skips lists that are switched off", () => {
    const rules = buildLiveSecurityRules({ "phishing-urls": ["a.example"], scam: ["s.example"] }, new Set(["scam"]));
    expect(rules.map((r) => r.condition.requestDomains)).toEqual([["s.example"]]);
  });

  it("stays inside its own id range", () => {
    const ids = new Set(allLiveSecurityRuleIds());
    expect(ids.size).toBe(MAX_LIVE_SECURITY_RULES);
    const rules = buildLiveSecurityRules({ "phishing-urls": ["a.example"] }, new Set(["phishing-urls"]));
    for (const rule of rules) expect(ids.has(rule.id)).toBe(true);
  });

  it("sits in the security band: above pause and Never block, below enterprise policy", () => {
    expect(LIVE_SECURITY_PRIORITY).toBeGreaterThan(SECURITY_PRIORITY_OFFSET);
    expect(LIVE_SECURITY_PRIORITY).toBeGreaterThan(PAUSE_PRIORITY);
    expect(LIVE_SECURITY_PRIORITY).toBeGreaterThan(BUNDLED_NON_SECURITY_MAX_PRIORITY);
    expect(LIVE_SECURITY_PRIORITY).toBeLessThan(ENTERPRISE_PRIORITY);
  });
});

describe("storeLiveSecurityPayload / applyLiveSecurityRules", () => {
  it("stores a verified payload and applies it for the lists whose bundled rulesets are on", async () => {
    enabledRulesets = ["ruleset_phishing-urls-1", "ruleset_ads-1"];
    const count = await storeLiveSecurityPayload({
      format: 1,
      generated: "2026-09-27T00:00:00Z",
      groups: { "phishing-urls": ["a.example", "google.com"], scam: ["s.example"] },
    });
    expect(count).toBe(2);
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const [{ removeRuleIds, addRules }] = updateDynamicRules.mock.calls[0] as unknown as [
      { removeRuleIds: number[]; addRules: { condition: { requestDomains: string[] } }[] },
    ];
    expect(removeRuleIds).toEqual(allLiveSecurityRuleIds());
    expect(addRules.map((r) => r.condition.requestDomains)).toEqual([["a.example"]]);
  });

  it("refuses a malformed payload and leaves what's applied alone", async () => {
    await expect(storeLiveSecurityPayload({ format: 2, groups: {} })).rejects.toThrow();
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it("with nothing stored, clears its own rules and adds none", async () => {
    await applyLiveSecurityRules();
    expect(updateDynamicRules).toHaveBeenCalledWith({ removeRuleIds: allLiveSecurityRuleIds(), addRules: [] });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};
const updateDynamicRules = vi.fn(async (_update: { removeRuleIds: number[]; addRules: unknown[] }) => {});
let enabledRulesets: string[] = [];
let extensionUrl = "chrome-extension://id/";
vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: { getURL: vi.fn(() => extensionUrl) },
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
  loadRulesetManifest: vi.fn(async () => [{ id: "ruleset_phishing-urls", group: "phishing-urls" }]),
}));

const { storeLookalikePayload, storedLookalikes } = await import("./liveLookalikeRules");
const { LIVE_LOOKALIKES_FORMAT, LOOKALIKE_RULE_ID } = await import("../shared/liveLookalikes");
const { LOOKALIKE_PRIORITY, NEVER_BLOCK_PRIORITY, QUICK_FIX_PRIORITY } = await import("../shared/rulePriorities");

const payload = { format: LIVE_LOOKALIKES_FORMAT, generated: "", domains: { "paypal-login.example": { brand: "PayPal", added: "2026-10-31" } } };
const lastUpdate = () => updateDynamicRules.mock.calls.at(-1)![0];

describe("liveLookalikeRules", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    updateDynamicRules.mockClear();
    enabledRulesets = ["ruleset_phishing-urls"];
    extensionUrl = "chrome-extension://id/";
  });

  it("stops the sites' pages below Never block, while the Phishing list is on", async () => {
    expect(await storeLookalikePayload(payload)).toBe(1);
    expect(await storedLookalikes()).toEqual({ "paypal-login.example": "PayPal" });
    expect(lastUpdate()).toEqual({
      removeRuleIds: [LOOKALIKE_RULE_ID],
      addRules: [{ id: LOOKALIKE_RULE_ID, priority: LOOKALIKE_PRIORITY, action: { type: "block" }, condition: { requestDomains: ["paypal-login.example"], resourceTypes: ["main_frame"] } }],
    });
    expect(LOOKALIKE_PRIORITY).toBeLessThan(NEVER_BLOCK_PRIORITY);
    expect(LOOKALIKE_PRIORITY).toBeGreaterThan(QUICK_FIX_PRIORITY);
  });

  it("adds no rule with the Phishing list off, or on Firefox", async () => {
    enabledRulesets = [];
    await storeLookalikePayload(payload);
    expect(lastUpdate().addRules).toEqual([]);
    enabledRulesets = ["ruleset_phishing-urls"];
    extensionUrl = "moz-extension://id/";
    await storeLookalikePayload(payload);
    expect(lastUpdate().addRules).toEqual([]);
  });

  it("refuses a malformed payload and keeps what it had", async () => {
    await storeLookalikePayload(payload);
    await expect(storeLookalikePayload({ format: 9 })).rejects.toThrow();
    expect(await storedLookalikes()).toEqual({ "paypal-login.example": "PayPal" });
  });
});

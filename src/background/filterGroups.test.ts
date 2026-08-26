import { describe, expect, it, vi } from "vitest";

// A tiny 3-list manifest -- one of each toggleable category -- sized so a
// mocked updateEnabledRulesets can only fit 2 of the 3 at once. This is a
// regression test for a real bug: the first version of the retry loop
// dropped from the wrong end of the priority-ordered list and ended up
// dropping the security list first (the one meant to be kept longest)
// instead of the annoyance list (the one meant to go first).
const MANIFEST = [
  { id: "ruleset_annoyances", group: "annoyances", category: "annoyance", name: "Annoyances", enabled: true, file: "x", ruleCount: 50 },
  { id: "ruleset_ads", group: "ads", category: "ads", name: "Ads", enabled: true, file: "x", ruleCount: 100 },
  { id: "ruleset_malicious-urls", group: "malicious-urls", category: "security", name: "Malicious URLs", enabled: true, file: "x", ruleCount: 30 },
];

let updateCalls: { enableRulesetIds: string[]; disableRulesetIds: string[] }[] = [];
let maxFittableRulesets = 3;
let alwaysFail = false;
const store: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: { getURL: (path: string) => `test://${path}` },
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        },
      },
    },
    declarativeNetRequest: {
      updateEnabledRulesets: (options: { enableRulesetIds: string[]; disableRulesetIds: string[] }) => {
        updateCalls.push(options);
        if (alwaysFail || options.enableRulesetIds.length > maxFittableRulesets) {
          return Promise.reject(new Error("exceeds static rule budget"));
        }
        return Promise.resolve();
      },
      getAvailableStaticRuleCount: () => Promise.resolve(0),
    },
  },
}));

vi.stubGlobal("fetch", () => Promise.resolve({ json: () => Promise.resolve(MANIFEST) }));

const { applyFilterGroupState, getFilterGroupStatus } = await import("./filterGroups");
const { DEFAULT_SETTINGS } = await import("../types");

describe("applyFilterGroupState under a tight rule budget", () => {
  it("drops the annoyance list first, never the security list, when only 2 of 3 lists fit", async () => {
    updateCalls = [];
    maxFittableRulesets = 2;
    await applyFilterGroupState(DEFAULT_SETTINGS);

    const status = await getFilterGroupStatus();
    expect(status?.droppedGroups).toEqual(["annoyances"]);
    expect(status?.ok).toBe(false);

    // The call that finally succeeded must never have tried to drop the
    // security-category list while a less-essential one was still enabled.
    const succeeded = updateCalls.at(-1)!;
    expect(succeeded.enableRulesetIds).toContain("ruleset_malicious-urls");
    expect(succeeded.enableRulesetIds).toContain("ruleset_ads");
    expect(succeeded.disableRulesetIds).toContain("ruleset_annoyances");
  });

  it("keeps only the security list when just 1 of 3 fits", async () => {
    updateCalls = [];
    maxFittableRulesets = 1;
    await applyFilterGroupState(DEFAULT_SETTINGS);

    const status = await getFilterGroupStatus();
    expect(status?.droppedGroups).toEqual(["annoyances", "ads"]);
  });

  it("enables everything with no drops when the full set fits", async () => {
    updateCalls = [];
    maxFittableRulesets = 3;
    await applyFilterGroupState(DEFAULT_SETTINGS);

    const status = await getFilterGroupStatus();
    expect(status).toEqual({ ok: true, timestamp: expect.any(Number) });
  });

  it("records the available rule count when even the single highest-priority list doesn't fit", async () => {
    updateCalls = [];
    alwaysFail = true;
    await applyFilterGroupState(DEFAULT_SETTINGS);
    alwaysFail = false;

    const status = await getFilterGroupStatus();
    expect(status?.ok).toBe(false);
    expect(status?.droppedGroups).toBeUndefined();
    expect(status?.availableStaticRuleCount).toBe(0);
  });
});

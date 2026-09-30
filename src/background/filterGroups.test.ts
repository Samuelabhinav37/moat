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
// The calls the mock accepted; the last one is what the browser ends up on.
let acceptedCalls: { enableRulesetIds: string[]; disableRulesetIds: string[] }[] = [];
let maxFittableRulesets = 3;
let alwaysFail = false;
const store: Record<string, unknown> = {};
// Separate from `store` (storage.local) -- applyFilterGroupState's
// "already applied this exact state" fast path lives in storage.session,
// same lifetime distinction the real code relies on (session storage is
// gone on browser restart/extension reload; local isn't). Reset per test
// same as `store`/updateCalls, since real session storage would carry
// nothing over between them in practice.
let sessionStore: Record<string, unknown> = {};

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
      session: {
        get: (key: string) => Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(sessionStore, items);
          return Promise.resolve();
        },
        remove: (key: string) => {
          delete sessionStore[key];
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
        acceptedCalls.push(options);
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
  it("leaves out the annoyance list when only 2 of 3 lists fit", async () => {
    updateCalls = [];
    acceptedCalls = [];
    sessionStore = {};
    maxFittableRulesets = 2;
    await applyFilterGroupState(DEFAULT_SETTINGS);

    const status = await getFilterGroupStatus();
    expect(status?.droppedGroups).toEqual(["annoyances"]);
    expect(status?.ok).toBe(false);

    // The browser ends on the last accepted call: ads and security on.
    const final = acceptedCalls.at(-1)!;
    expect(final.enableRulesetIds).toEqual(expect.arrayContaining(["ruleset_ads", "ruleset_malicious-urls"]));
    expect(final.disableRulesetIds).toContain("ruleset_annoyances");
  });

  it("keeps the ads list when just 1 of 3 fits", async () => {
    // Ads first: it's an ad blocker. The security list's domains still apply
    // through the daily lists, which are dynamic rules and use no budget.
    updateCalls = [];
    acceptedCalls = [];
    sessionStore = {};
    maxFittableRulesets = 1;
    await applyFilterGroupState(DEFAULT_SETTINGS);

    const status = await getFilterGroupStatus();
    expect(status?.droppedGroups).toEqual(["malicious-urls", "annoyances"]);
    expect(acceptedCalls.at(-1)!.enableRulesetIds).toEqual(["ruleset_ads"]);
  });

  it("fills around a list that doesn't fit instead of stopping at it", async () => {
    // Only 2 fit: ads is kept, security fits next, annoyances is skipped.
    // The old front-drop loop would have stopped at the first set that fit.
    updateCalls = [];
    acceptedCalls = [];
    sessionStore = {};
    maxFittableRulesets = 2;
    await applyFilterGroupState(DEFAULT_SETTINGS);
    expect(acceptedCalls.at(-1)!.enableRulesetIds).toHaveLength(2);
  });

  it("enables everything with no drops when the full set fits", async () => {
    updateCalls = [];
    sessionStore = {};
    maxFittableRulesets = 3;
    await applyFilterGroupState(DEFAULT_SETTINGS);

    const status = await getFilterGroupStatus();
    expect(status).toEqual({ ok: true, timestamp: expect.any(Number) });
  });

  it("records the available rule count when even the single highest-priority list doesn't fit", async () => {
    updateCalls = [];
    sessionStore = {};
    alwaysFail = true;
    await applyFilterGroupState(DEFAULT_SETTINGS);
    alwaysFail = false;

    const status = await getFilterGroupStatus();
    expect(status?.ok).toBe(false);
    expect(status?.droppedGroups).toBeUndefined();
    expect(status?.availableStaticRuleCount).toBe(0);
  });
});

describe("applyFilterGroupState's fast path (skip re-applying an unchanged, fully-successful state)", () => {
  it("skips the declarativeNetRequest call entirely on a second call with the same settings", async () => {
    updateCalls = [];
    sessionStore = {};
    maxFittableRulesets = 3;
    await applyFilterGroupState(DEFAULT_SETTINGS);
    expect(updateCalls.length).toBe(1);

    await applyFilterGroupState(DEFAULT_SETTINGS);
    expect(updateCalls.length).toBe(1); // no second call -- fingerprint matched, nothing dropped last time
  });

  it("does not skip when force is passed, even with an unchanged fingerprint", async () => {
    updateCalls = [];
    sessionStore = {};
    maxFittableRulesets = 3;
    await applyFilterGroupState(DEFAULT_SETTINGS);
    expect(updateCalls.length).toBe(1);

    await applyFilterGroupState(DEFAULT_SETTINGS, { force: true });
    expect(updateCalls.length).toBe(2);
  });

  it("never skips when the last apply left something dropped, even without force", async () => {
    updateCalls = [];
    sessionStore = {};
    maxFittableRulesets = 2; // annoyances gets dropped
    await applyFilterGroupState(DEFAULT_SETTINGS);
    const first = updateCalls.length; // the full attempt, then the fill

    await applyFilterGroupState(DEFAULT_SETTINGS);
    expect(updateCalls.length).toBeGreaterThan(first); // retried, not skipped
  });

  it("re-applies once the desired settings actually change, even with a cached fingerprint", async () => {
    updateCalls = [];
    sessionStore = {};
    maxFittableRulesets = 3;
    await applyFilterGroupState(DEFAULT_SETTINGS);
    expect(updateCalls.length).toBe(1);

    await applyFilterGroupState({ ...DEFAULT_SETTINGS, enabled: false });
    expect(updateCalls.length).toBe(2);
  });
});

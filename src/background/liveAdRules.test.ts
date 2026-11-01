import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};
const updateDynamicRules = vi.fn(async (_update: { removeRuleIds: number[]; addRules: unknown[] }) => {});
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
    { id: "ruleset_oisd-1", group: "oisd" },
    { id: "ruleset_ads-1", group: "ads" },
  ]),
}));

const { buildLiveAdRules, storeLiveAdPayload } = await import("./liveAdRules");
const { LIVE_AD_ID_START, LIVE_ADS_FORMAT } = await import("../shared/liveAds");

const payload = (domains: unknown[]) => ({ format: LIVE_ADS_FORMAT, generated: "", release: "0.11.288", domains });

describe("buildLiveAdRules", () => {
  it("packs the domains like the bundled oisd rules: never the page itself, at the lists' priority", () => {
    const [rule, ...rest] = buildLiveAdRules(["a.example", "b.example"], true);
    expect(rest).toEqual([]);
    expect(rule).toMatchObject({ id: LIVE_AD_ID_START, priority: 1, action: { type: "block" }, condition: { requestDomains: ["a.example", "b.example"] } });
    expect(rule!.condition.resourceTypes).not.toContain("main_frame");
  });

  it("adds nothing while oisd is off", () => {
    expect(buildLiveAdRules(["a.example"], false)).toEqual([]);
  });
});

describe("storeLiveAdPayload", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    updateDynamicRules.mockClear();
  });

  it("cleans what it's sent and applies it only while oisd is on", async () => {
    enabledRulesets = ["ruleset_oisd-1"];
    expect(await storeLiveAdPayload(payload(["New.Example", "1.2.3.4", "google.com", 7]))).toBe(1);
    expect(updateDynamicRules.mock.calls[0]![0].addRules).toMatchObject([{ condition: { requestDomains: ["new.example"] } }]);
    enabledRulesets = ["ruleset_ads-1"];
    await storeLiveAdPayload(payload(["new.example"]));
    expect(updateDynamicRules.mock.calls[1]![0]).toMatchObject({ removeRuleIds: expect.arrayContaining([LIVE_AD_ID_START]), addRules: [] });
  });

  it("refuses a malformed payload", async () => {
    await expect(storeLiveAdPayload({ format: 2, domains: [] })).rejects.toThrow();
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });
});

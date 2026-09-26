import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: { runtime: { getURL: (path: string) => `test://${path}` } },
}));
vi.mock("./rulesetManifestLoader", () => ({
  loadRulesetManifest: () =>
    Promise.resolve([
      { id: "ruleset_trackers-3", group: "trackers", category: "core", name: "", enabled: true, file: "", ruleCount: 0 },
      { id: "ruleset_ads-1", group: "ads", category: "ads", name: "", enabled: true, file: "", ruleCount: 0 },
    ]),
}));
vi.mock("./managedPolicy", () => ({ getManagedPolicy: vi.fn() }));
vi.mock("./athenaIntegration", () => ({ isAthenaConfigured: () => false, queueSecurityEvent: vi.fn() }));
vi.mock("./securityRuleDomain", () => ({ resolveSecurityRuleDomain: vi.fn() }));

const files: Record<string, unknown> = {
  "test://rules/rule-companies.json": {},
  // A Permissions-Policy header rule: matches every page load, blocks nothing.
  "test://rules/uncounted-rules.json": { "ruleset_trackers-3": [339185644] },
};
vi.stubGlobal("fetch", (url: string) => Promise.resolve({ json: () => Promise.resolve(files[url]) }));

const getMatchedRules = vi.fn();
vi.stubGlobal("chrome", { declarativeNetRequest: { getMatchedRules } });

const { refreshBreakdown, resetBreakdown, forgetTab } = await import("./matchStats");

function matched(...rules: [string, number][]) {
  return { rulesMatchedInfo: rules.map(([rulesetId, ruleId]) => ({ rule: { rulesetId, ruleId } })) };
}

describe("refreshBreakdown", () => {
  beforeEach(() => {
    getMatchedRules.mockReset();
    forgetTab(1);
  });

  it("doesn't count rules that match without blocking", async () => {
    getMatchedRules.mockResolvedValue(matched(["ruleset_trackers-3", 339185644], ["ruleset_ads-1", 7]));
    expect(await refreshBreakdown(1)).toEqual({ ads: 1, trackers: 0, popups: 0 });
  });

  it("asks only for matches since the current page committed", async () => {
    getMatchedRules.mockResolvedValue(matched());
    resetBreakdown(1, 1_700_000_000_000);
    await refreshBreakdown(1);
    expect(getMatchedRules).toHaveBeenCalledWith({ tabId: 1, minTimeStamp: 1_700_000_000_000 });
  });

  it("falls back to the whole tab when no commit was seen (e.g. after a worker restart)", async () => {
    getMatchedRules.mockResolvedValue(matched());
    await refreshBreakdown(1);
    expect(getMatchedRules).toHaveBeenCalledWith({ tabId: 1 });
  });
});

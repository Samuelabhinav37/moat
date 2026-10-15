import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../types";
import { isCnameCloakDestination } from "./cnameUncloakMatch";

vi.mock("webextension-polyfill", () => ({
  default: { runtime: { getURL: (path: string) => `test://${path}` } },
}));

const {
  buildDestinationSet,
  uncloakGroupsOn,
  setUncloakSettings,
  isPagePaused,
  loadCloakDestinations,
  resetCnameDestinationsForTest,
} = await import("./cnameDestinations");

const FILES: Record<string, unknown> = {
  "test://rules/cname-cloak-destinations.json": ["cloak.example"],
  "test://rules/rulesets.json": [
    { id: "ruleset_trackers", group: "trackers", file: "ruleset_trackers.json" },
    { id: "ruleset_ads", group: "ads", file: "ruleset_ads.json" },
    { id: "ruleset_scam", group: "scam", file: "ruleset_scam.json" },
  ],
  // A plain domain block counts; one limited to a site doesn't (it blocks less than the whole domain).
  "test://rules/ruleset_trackers.json": [
    { id: 1, action: { type: "block" }, condition: { urlFilter: "||tracker.example^" } },
    { id: 2, action: { type: "block" }, condition: { urlFilter: "||narrow.example^", initiatorDomains: ["one.example"] } },
  ],
  "test://rules/ruleset_ads.json": [{ id: 1, action: { type: "block" }, condition: { requestDomains: ["ads.example"], resourceTypes: ["script"] } }],
};

const fetchMock = vi.fn(async (url: string) => ({ json: async () => FILES[url] }));

function settings(overrides: Partial<Settings>): Settings {
  return { enabled: true, filterGroups: {}, disabledSites: [], ...overrides } as Settings;
}

beforeEach(() => {
  resetCnameDestinationsForTest();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("buildDestinationSet", () => {
  it("adds only the lists that are on", () => {
    const set = buildDestinationSet(["cloak.example"], { trackers: ["t.example"], ads: ["a.example"] }, ["trackers"]);
    expect([...set].sort()).toEqual(["cloak.example", "t.example"]);
  });
});

describe("uncloakGroupsOn", () => {
  it("follows the filter-list switches, defaulting to on", () => {
    expect(uncloakGroupsOn(settings({}))).toEqual(["trackers", "ads"]);
    expect(uncloakGroupsOn(settings({ filterGroups: { trackers: false } }))).toEqual(["ads"]);
    expect(uncloakGroupsOn(settings({ enabled: false }))).toEqual([]);
  });
});

describe("isPagePaused", () => {
  it("matches a paused site and its subdomains only", () => {
    setUncloakSettings(settings({ disabledSites: ["paused.example"] }));
    expect(isPagePaused("paused.example")).toBe(true);
    expect(isPagePaused("www.paused.example")).toBe(true);
    expect(isPagePaused("other.example")).toBe(false);
  });
});

describe("loadCloakDestinations", () => {
  it("catches a disguised address that points at one of Moat's own tracker domains", async () => {
    setUncloakSettings(settings({}));
    const set = await loadCloakDestinations();
    expect(isCnameCloakDestination("eu.collect.tracker.example", set)).toBe(true);
    expect(isCnameCloakDestination("x.cloak.example", set)).toBe(true);
    expect(isCnameCloakDestination("cdn.harmless.example", set)).toBe(false);
    expect(isCnameCloakDestination("x.narrow.example", set)).toBe(false);
    expect(set.has("ads.example")).toBe(true);
  });

  it("stops using the tracker list once Trackers is turned off", async () => {
    setUncloakSettings(settings({}));
    expect((await loadCloakDestinations()).has("tracker.example")).toBe(true);

    setUncloakSettings(settings({ filterGroups: { trackers: false } }));
    const set = await loadCloakDestinations();
    expect(set.has("tracker.example")).toBe(false);
    expect(set.has("ads.example")).toBe(true);
  });

  it("reads the files once while the lists stay the same, even for a burst of requests", async () => {
    setUncloakSettings(settings({}));
    await Promise.all([loadCloakDestinations(), loadCloakDestinations(), loadCloakDestinations()]);
    await loadCloakDestinations();
    // The cloak list, the ruleset list, and the two rulesets that are on.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reads no rulesets when neither list is on", async () => {
    setUncloakSettings(settings({ filterGroups: { trackers: false, ads: false } }));
    await loadCloakDestinations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("test://rules/cname-cloak-destinations.json");
  });
});

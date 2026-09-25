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
  "test://rules/uncloak-domains.json": { trackers: ["tracker.example"], ads: ["ads.example"] },
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
  });

  it("stops using the tracker list once Trackers is turned off", async () => {
    setUncloakSettings(settings({}));
    expect((await loadCloakDestinations()).has("tracker.example")).toBe(true);

    setUncloakSettings(settings({ filterGroups: { trackers: false } }));
    const set = await loadCloakDestinations();
    expect(set.has("tracker.example")).toBe(false);
    expect(set.has("ads.example")).toBe(true);
  });

  it("loads the files once while the lists stay the same, even for a burst of requests", async () => {
    setUncloakSettings(settings({}));
    await Promise.all([loadCloakDestinations(), loadCloakDestinations(), loadCloakDestinations()]);
    await loadCloakDestinations();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips the big domain file when neither list is on", async () => {
    setUncloakSettings(settings({ filterGroups: { trackers: false, ads: false } }));
    await loadCloakDestinations();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("test://rules/cname-cloak-destinations.json");
  });
});

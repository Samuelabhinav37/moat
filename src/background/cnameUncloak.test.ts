import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../types";

const addListener = vi.fn();
const removeListener = vi.fn();
const resolve = vi.fn(async (hostname: string) => ({
  canonicalName: hostname === "metrics.site.example" || hostname === "metrics.paused.example" ? "eu.collect.tracker.example" : hostname,
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    webRequest: { onBeforeRequest: { addListener, removeListener } },
    dns: { resolve },
    runtime: { getURL: (path: string) => `test://${path}` },
  },
}));
vi.mock("./usageStats", () => ({ recordSignalEvent: vi.fn(() => Promise.resolve()) }));
vi.mock("./liveHeuristics", () => ({ recordFired: vi.fn() }));

const { applyCnameUncloak } = await import("./cnameUncloak");
const { resetCnameDestinationsForTest } = await import("./cnameDestinations");

const FILES: Record<string, unknown> = {
  "test://rules/cname-cloak-destinations.json": ["cloak.example"],
  "test://rules/uncloak-domains.json": { trackers: ["tracker.example"], ads: [] },
};

function settings(overrides: Partial<Settings> = {}): Settings {
  return { enabled: true, cnameUncloaking: true, filterGroups: {}, disabledSites: [], ...overrides } as Settings;
}

type Listener = (details: unknown) => Promise<{ cancel?: boolean }>;

function listenerFor(s: Settings): Listener {
  applyCnameUncloak({ ...s, cnameUncloaking: false });
  addListener.mockClear();
  applyCnameUncloak(s);
  return addListener.mock.calls.at(-1)![0] as Listener;
}

beforeEach(() => {
  resetCnameDestinationsForTest();
  resolve.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ json: async () => FILES[url] })));
});
afterEach(() => vi.unstubAllGlobals());

describe("the Firefox uncloaking listener", () => {
  it("cancels a disguised subdomain whose real address is one of Moat's own tracker domains", async () => {
    const listener = listenerFor(settings());
    const result = await listener({ url: "https://metrics.site.example/c", documentUrl: "https://site.example/", frameId: 0, type: "script", tabId: 1 });
    expect(result).toEqual({ cancel: true });
  });

  it("leaves it alone once Trackers is turned off", async () => {
    const listener = listenerFor(settings({ filterGroups: { trackers: false } }));
    const result = await listener({ url: "https://metrics.site.example/c", documentUrl: "https://site.example/", frameId: 0, type: "script", tabId: 1 });
    expect(result).toEqual({});
  });

  it("never resolves or cancels anything on a paused site", async () => {
    const listener = listenerFor(settings({ disabledSites: ["paused.example"] }));
    const result = await listener({ url: "https://metrics.paused.example/c", documentUrl: "https://paused.example/", frameId: 0, type: "script", tabId: 1 });
    expect(result).toEqual({});
    expect(resolve).not.toHaveBeenCalled();
  });
});

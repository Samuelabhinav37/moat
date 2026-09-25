import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../types";

const addListener = vi.fn();
const removeListener = vi.fn();
const updateDynamicRules = vi.fn(() => Promise.resolve());

vi.mock("webextension-polyfill", () => ({
  default: {
    webRequest: { onBeforeRequest: { addListener, removeListener } },
    declarativeNetRequest: { updateDynamicRules },
    dns: undefined,
    runtime: { getURL: (path: string) => `test://${path}` },
  },
}));

vi.mock("./usageStats", () => ({ recordSignalEvent: vi.fn(() => Promise.resolve()) }));
vi.mock("./liveHeuristics", () => ({ recordFired: vi.fn() }));

const { applyCnameUncloakChrome } = await import("./cnameUncloakChrome");
const { resetCnameDestinationsForTest } = await import("./cnameDestinations");

const baseSettings: Settings = {
  disabledSites: [],
  enabled: true,
  webrtcLeakProtection: false,
  blockThirdPartyCookies: false,
  firefoxResistFingerprinting: false,
  firefoxFirstPartyIsolate: false,
  fingerprintResistance: false,
  fingerprintSeed: "",
  fingerprintRotatePerSession: false,
  filterGroups: {},
  customBlockedDomains: [],
  customAllowedDomains: [],
  customCosmeticRules: {},
  customGrayscaleRules: {},
  grayscaleUnblockableAds: false,
  aggressiveFeedAdRemoval: false,
  cookieBannerAutoReject: false,
  cnameUncloaking: false,
  syncEnabled: false,
  leakedPasswordCheck: false,
  permissionGuardCamera: false,
  permissionGuardMicrophone: false,
  permissionGuardLocation: false,
  hideSeoSpamResults: false,
  perSiteOverrides: {},
};

// applyCnameUncloakChrome tracks "have we already cleaned up" in module-level
// state that only resets on re-enable, not between tests -- run every test
// through an explicit enable-then-settle step where the scenario needs a
// clean "never cleaned up yet" starting point, same as a fresh worker
// instance would have on its very first settings apply.
beforeEach(() => {
  addListener.mockClear();
  removeListener.mockClear();
  updateDynamicRules.mockClear();
});

describe("applyCnameUncloakChrome", () => {
  it("registers the listener when the feature turns on", () => {
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: true });
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it("removes the listener and clears dynamic rules when the feature turns off", () => {
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: true });
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: false });
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(updateDynamicRules).toHaveBeenCalledWith(expect.objectContaining({ removeRuleIds: expect.any(Array) }));
  });

  it("clears dynamic rules on the master toggle turning off too, not just the feature toggle", () => {
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: true, enabled: true });
    updateDynamicRules.mockClear();
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: true, enabled: false });
    expect(updateDynamicRules).toHaveBeenCalledWith(expect.objectContaining({ removeRuleIds: expect.any(Array) }));
  });

  it("cleans up once per off period, not on every single reapply while already off", () => {
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: true });
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: false });
    updateDynamicRules.mockClear();
    // Another unrelated settings change while still off shouldn't re-trigger cleanup.
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: false, webrtcLeakProtection: true });
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });

  it("retries cleanup on a later reapply if the first attempt failed", async () => {
    updateDynamicRules.mockRejectedValueOnce(new Error("quota"));
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: true });
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: false });
    await Promise.resolve(); // let the rejected promise's .catch flip cleanupChecked back
    await Promise.resolve();
    updateDynamicRules.mockClear();
    applyCnameUncloakChrome({ ...baseSettings, cnameUncloaking: false, webrtcLeakProtection: true });
    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
  });
});

describe("the Chrome uncloaking listener", () => {
  // DoH answers: metrics.site.example is a disguised subdomain whose real
  // address is one of Moat's own tracker domains (not on the CNAME list).
  const FILES: Record<string, unknown> = {
    "test://rules/cname-cloak-destinations.json": ["cloak.example"],
    "test://rules/uncloak-domains.json": { trackers: ["tracker.example"], ads: [] },
  };
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("https://cloudflare-dns.com/")) {
      return { ok: true, json: async () => ({ Answer: [{ type: 5, data: "eu.collect.tracker.example." }] }) };
    }
    return { ok: true, json: async () => FILES[url] };
  });

  beforeEach(() => {
    resetCnameDestinationsForTest();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function fire(settings: Settings, page: string, request: string): Promise<void> {
    addListener.mockClear();
    // Off first, so the listener registers fresh and this test gets its own copy.
    applyCnameUncloakChrome({ ...settings, cnameUncloaking: false });
    applyCnameUncloakChrome({ ...settings, cnameUncloaking: true });
    const listener = addListener.mock.calls.at(-1)![0] as (details: unknown) => void;
    updateDynamicRules.mockClear();
    // The shape Chrome really sends for a top-page request: frameId 0, no documentUrl.
    listener({ url: request, initiator: new URL(page).origin, frameId: 0, type: "script", tabId: 3 });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("blocks a disguised subdomain whose real address is one of Moat's own tracker domains", async () => {
    await fire(baseSettings, "https://site.example/", "https://metrics.site.example/collect");
    expect(updateDynamicRules).toHaveBeenCalledWith(
      expect.objectContaining({ addRules: [expect.objectContaining({ condition: expect.objectContaining({ urlFilter: "||metrics.site.example^" }) })] })
    );
  });

  it("never looks up or blocks anything on a paused site", async () => {
    await fire({ ...baseSettings, disabledSites: ["paused.example"] }, "https://paused.example/", "https://metrics.paused.example/collect");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("cloudflare-dns.com"), expect.anything());
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });
});

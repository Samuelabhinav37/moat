import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { applyCnameUncloakChrome } = await import("./cnameUncloakChrome");

const baseSettings: Settings = {
  disabledSites: [],
  enabled: true,
  webrtcLeakProtection: false,
  blockThirdPartyCookies: false,
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

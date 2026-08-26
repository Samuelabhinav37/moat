import { describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { Settings } from "../types";

vi.mock("webextension-polyfill", () => ({
  default: { privacy: undefined },
}));

const { applyPrivacySettings } = await import("./privacySettings");

const baseSettings: Settings = {
  disabledSites: [],
  enabled: true,
  webrtcLeakProtection: false,
  blockThirdPartyCookies: false,
  fingerprintResistance: false,
  fingerprintSeed: "",
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
};

function setPrivacy(privacy: unknown): void {
  (browser as unknown as { privacy: unknown }).privacy = privacy;
}

describe("applyPrivacySettings", () => {
  it("does nothing (and doesn't throw) when browser.privacy is unavailable", async () => {
    setPrivacy(undefined);
    await expect(applyPrivacySettings(baseSettings)).resolves.toBeUndefined();
  });

  it("sets the Chrome-shaped thirdPartyCookiesAllowed when present, not cookieConfig", async () => {
    const thirdPartyCookiesAllowed = { set: vi.fn(() => Promise.resolve()) };
    const cookieConfig = { set: vi.fn(() => Promise.resolve()) };
    setPrivacy({
      network: { webRTCIPHandlingPolicy: { set: vi.fn(() => Promise.resolve()) } },
      websites: { thirdPartyCookiesAllowed, cookieConfig },
    });

    await applyPrivacySettings({ ...baseSettings, blockThirdPartyCookies: true });

    expect(thirdPartyCookiesAllowed.set).toHaveBeenCalledWith({ value: false });
    expect(cookieConfig.set).not.toHaveBeenCalled();
  });

  it("clears thirdPartyCookiesAllowed (rather than setting it) when blockThirdPartyCookies is false (Chrome shape)", async () => {
    const thirdPartyCookiesAllowed = { set: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve()) };
    setPrivacy({ websites: { thirdPartyCookiesAllowed } });

    await applyPrivacySettings({ ...baseSettings, blockThirdPartyCookies: false });

    expect(thirdPartyCookiesAllowed.clear).toHaveBeenCalledWith({});
    expect(thirdPartyCookiesAllowed.set).not.toHaveBeenCalled();
  });

  it("falls back to Firefox's cookieConfig when thirdPartyCookiesAllowed doesn't exist", async () => {
    const cookieConfig = { set: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve()) };
    setPrivacy({ websites: { cookieConfig } });

    await applyPrivacySettings({ ...baseSettings, blockThirdPartyCookies: true });

    expect(cookieConfig.set).toHaveBeenCalledWith({ value: { behavior: "reject_third_party" } });
  });

  it("clears cookieConfig (rather than setting it back to allow_all) when the toggle is off (Firefox shape)", async () => {
    const cookieConfig = { set: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve()) };
    setPrivacy({ websites: { cookieConfig } });

    await applyPrivacySettings({ ...baseSettings, blockThirdPartyCookies: false });

    expect(cookieConfig.clear).toHaveBeenCalledWith({});
    expect(cookieConfig.set).not.toHaveBeenCalled();
  });

  it("maps webrtcLeakProtection to disable_non_proxied_udp when on, clears the setting when off", async () => {
    const webRTCIPHandlingPolicy = { set: vi.fn(() => Promise.resolve()), clear: vi.fn(() => Promise.resolve()) };
    setPrivacy({ network: { webRTCIPHandlingPolicy } });

    await applyPrivacySettings({ ...baseSettings, webrtcLeakProtection: true });
    expect(webRTCIPHandlingPolicy.set).toHaveBeenCalledWith({ value: "disable_non_proxied_udp" });

    webRTCIPHandlingPolicy.set.mockClear();
    await applyPrivacySettings({ ...baseSettings, webrtcLeakProtection: false });
    expect(webRTCIPHandlingPolicy.clear).toHaveBeenCalledWith({});
    expect(webRTCIPHandlingPolicy.set).not.toHaveBeenCalled();
  });

  it("always tries to enable the native Firefox GPC setting when present, regardless of toggles", async () => {
    const globalPrivacyControl = { set: vi.fn(() => Promise.resolve()) };
    setPrivacy({ network: { globalPrivacyControl } });

    await applyPrivacySettings(baseSettings);

    expect(globalPrivacyControl.set).toHaveBeenCalledWith({ value: true });
  });

  it("swallows a rejected settings.set() instead of throwing (e.g. enterprise policy lock)", async () => {
    const webRTCIPHandlingPolicy = { set: vi.fn(() => Promise.reject(new Error("locked by policy"))) };
    setPrivacy({ network: { webRTCIPHandlingPolicy } });

    await expect(applyPrivacySettings({ ...baseSettings, webrtcLeakProtection: true })).resolves.toBeUndefined();
  });
});

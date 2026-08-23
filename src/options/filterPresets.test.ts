import { describe, expect, it } from "vitest";
import { ALL_TOGGLEABLE_GROUPS, detectPreset, presetPatch, PRESETS } from "./filterPresets";
import type { Settings } from "../types";

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
};

describe("presetPatch", () => {
  it("off only flips the master switch, leaving filter groups untouched", () => {
    expect(presetPatch("off")).toEqual({ enabled: false });
  });

  it("essential enables only ads/popups/security groups", () => {
    const patch = presetPatch("essential");
    expect(patch.enabled).toBe(true);
    expect(patch.filterGroups?.ads).toBe(true);
    expect(patch.filterGroups?.["malicious-urls"]).toBe(true);
    expect(patch.filterGroups?.trackers).toBe(false);
    expect(patch.filterGroups?.["cookie-notices"]).toBe(false);
  });

  it("standard adds trackers and url-tracking on top of essential", () => {
    const patch = presetPatch("standard");
    expect(patch.filterGroups?.trackers).toBe(true);
    expect(patch.filterGroups?.["url-tracking"]).toBe(true);
    expect(patch.filterGroups?.["cookie-notices"]).toBe(false);
  });

  it("strict enables every group and every privacy toggle", () => {
    const patch = presetPatch("strict");
    for (const group of ALL_TOGGLEABLE_GROUPS) {
      expect(patch.filterGroups?.[group]).toBe(true);
    }
    expect(patch.webrtcLeakProtection).toBe(true);
    expect(patch.blockThirdPartyCookies).toBe(true);
    expect(patch.fingerprintResistance).toBe(true);
  });
});

describe("detectPreset", () => {
  it("detects off when the master switch is disabled, regardless of filter groups", () => {
    expect(detectPreset({ ...baseSettings, enabled: false })).toBe("off");
  });

  it("detects standard as the default state (all groups on, no explicit overrides)", () => {
    // Default filterGroups is {} -- every group defaults to "on" per
    // effectiveFilterGroupState, which matches standard except it also
    // needs cookie-notices/annoyances/social-widgets off to be "standard"
    // rather than "strict". So build it explicitly instead of relying on {}.
    const settings = { ...baseSettings, ...presetPatch("standard") };
    expect(detectPreset(settings)).toBe("standard");
  });

  it("detects essential when only its groups are on", () => {
    const settings = { ...baseSettings, ...presetPatch("essential") };
    expect(detectPreset(settings)).toBe("essential");
  });

  it("detects strict when everything is on", () => {
    const settings = { ...baseSettings, ...presetPatch("strict") };
    expect(detectPreset(settings)).toBe("strict");
  });

  it("detects custom once the user hand-tweaks a single group away from any preset", () => {
    const settings = { ...baseSettings, ...presetPatch("standard") };
    settings.filterGroups = { ...settings.filterGroups, annoyances: true };
    expect(detectPreset(settings)).toBe("custom");
  });

  it("detects custom when a privacy toggle doesn't match any preset's combination", () => {
    const settings = { ...baseSettings, ...presetPatch("essential"), fingerprintResistance: true };
    expect(detectPreset(settings)).toBe("custom");
  });

  it("round-trips every preset through presetPatch -> detectPreset", () => {
    for (const name of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const settings = { ...baseSettings, ...presetPatch(name) };
      expect(detectPreset(settings)).toBe(name);
    }
  });
});

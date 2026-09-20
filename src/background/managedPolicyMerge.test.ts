import { describe, expect, it } from "vitest";
import { applyManagedOverrides, isLocked } from "./managedPolicyMerge";
import type { ManagedPolicy, Settings } from "../types";

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

describe("applyManagedOverrides", () => {
  it("returns settings unchanged when there's no policy", () => {
    expect(applyManagedOverrides(baseSettings, {})).toEqual(baseSettings);
  });

  it("forces enabled on when forceEnabled is set, even if the user turned it off", () => {
    const settings = { ...baseSettings, enabled: false };
    expect(applyManagedOverrides(settings, { forceEnabled: true }).enabled).toBe(true);
  });

  it("clears per-site pauses when forceEnabled is set, so they can't quietly undo it", () => {
    const settings = { ...baseSettings, disabledSites: ["example.com"] };
    expect(applyManagedOverrides(settings, { forceEnabled: true }).disabledSites).toEqual([]);
  });

  it("lets the user's own filterGroups win over managed defaults when not locked", () => {
    const settings = { ...baseSettings, filterGroups: { ads: false } };
    const policy: ManagedPolicy = { managedFilterGroups: { ads: true, trackers: true } };
    const effective = applyManagedOverrides(settings, policy);
    expect(effective.filterGroups).toEqual({ ads: false, trackers: true });
  });

  it("forces managed filterGroups over the user's own when locked", () => {
    const settings = { ...baseSettings, filterGroups: { ads: false } };
    const policy: ManagedPolicy = { lockFilterGroups: true, managedFilterGroups: { ads: true } };
    const effective = applyManagedOverrides(settings, policy);
    expect(effective.filterGroups).toEqual({ ads: true });
  });

  it("adds managedCustomBlockedDomains on top of the user's own list, deduped", () => {
    const settings = { ...baseSettings, customBlockedDomains: ["a.com"] };
    const policy: ManagedPolicy = { managedCustomBlockedDomains: ["a.com", "b.com"] };
    const effective = applyManagedOverrides(settings, policy);
    expect(effective.customBlockedDomains.sort()).toEqual(["a.com", "b.com"]);
  });

  it("does not mutate the input settings object", () => {
    const settings = { ...baseSettings, filterGroups: { ads: false } };
    applyManagedOverrides(settings, { lockFilterGroups: true, managedFilterGroups: { ads: true } });
    expect(settings.filterGroups).toEqual({ ads: false });
  });

  // getManagedPolicy() casts whatever browser.storage.managed.get() returns
  // straight to ManagedPolicy with no runtime check -- these simulate a
  // malformed/wrong-shaped managed value slipping past that cast (a schema
  // gap, or a registry/plist edited directly outside the schema on some
  // platforms) reaching this function's real, unchecked inputs.
  describe("malformed managed policy values (schema bypass / wrong shape)", () => {
    it("ignores managedCustomBlockedDomains entirely if it's a string, not an array (would otherwise spread individual characters)", () => {
      const settings = { ...baseSettings, customBlockedDomains: ["a.com"] };
      const policy = { managedCustomBlockedDomains: "not-an-array" } as unknown as ManagedPolicy;
      const effective = applyManagedOverrides(settings, policy);
      expect(effective.customBlockedDomains).toEqual(["a.com"]);
    });

    it("ignores managedCustomBlockedDomains if it contains a non-string entry", () => {
      const settings = { ...baseSettings, customBlockedDomains: [] };
      const policy = { managedCustomBlockedDomains: ["a.com", 123] } as unknown as ManagedPolicy;
      const effective = applyManagedOverrides(settings, policy);
      expect(effective.customBlockedDomains).toEqual([]);
    });

    it("ignores managedFilterGroups entirely if it's an array, not a record", () => {
      const settings = { ...baseSettings, filterGroups: { ads: false } };
      const policy = { managedFilterGroups: ["ads", "trackers"] } as unknown as ManagedPolicy;
      const effective = applyManagedOverrides(settings, policy);
      expect(effective.filterGroups).toEqual({ ads: false });
    });

    it("ignores managedFilterGroups if any value isn't a boolean", () => {
      const settings = { ...baseSettings, filterGroups: { ads: false } };
      const policy = { managedFilterGroups: { ads: "yes" } } as unknown as ManagedPolicy;
      const effective = applyManagedOverrides(settings, policy);
      expect(effective.filterGroups).toEqual({ ads: false });
    });

    it("ignores managedFilterGroups if it's null", () => {
      const settings = { ...baseSettings, filterGroups: { ads: false } };
      const policy = { managedFilterGroups: null } as unknown as ManagedPolicy;
      const effective = applyManagedOverrides(settings, policy);
      expect(effective.filterGroups).toEqual({ ads: false });
    });

    it("still applies forceEnabled correctly even when other fields in the same policy are malformed", () => {
      const settings = { ...baseSettings, enabled: false };
      const policy = { forceEnabled: true, managedCustomBlockedDomains: "garbage" } as unknown as ManagedPolicy;
      const effective = applyManagedOverrides(settings, policy);
      expect(effective.enabled).toBe(true);
      expect(effective.customBlockedDomains).toEqual([]);
    });
  });
});

describe("isLocked", () => {
  it("locks protection when forceEnabled is set even without an explicit lock flag", () => {
    expect(isLocked("protection", { forceEnabled: true })).toBe(true);
  });

  it("locks protection when lockProtectionToggle is set", () => {
    expect(isLocked("protection", { lockProtectionToggle: true })).toBe(true);
  });

  it("does not lock protection with no relevant policy", () => {
    expect(isLocked("protection", {})).toBe(false);
  });

  it("locks filterGroups only via lockFilterGroups", () => {
    expect(isLocked("filterGroups", { lockFilterGroups: true })).toBe(true);
    expect(isLocked("filterGroups", { forceEnabled: true })).toBe(false);
  });
});

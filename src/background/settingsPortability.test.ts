import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../types";
import { exportSettings, validateImportedSettings } from "./settingsPortability";

const FULL_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  fingerprintSeed: "some-random-uuid",
  disabledSites: ["example.com"],
  filterGroups: { ads: false },
  customBlockedDomains: ["bad.example"],
  customAllowedDomains: ["good.example"],
  customCosmeticRules: { "example.com": [".ad"] },
  customGrayscaleRules: { "example.com": [".video-ad"] },
};

describe("exportSettings", () => {
  it("excludes fingerprintSeed", () => {
    const exported = exportSettings(FULL_SETTINGS);
    expect(exported).not.toHaveProperty("fingerprintSeed");
    expect(exported.disabledSites).toEqual(["example.com"]);
  });
});

describe("validateImportedSettings", () => {
  it("accepts a full valid export", () => {
    const exported = exportSettings(FULL_SETTINGS);
    const patch = validateImportedSettings(exported);
    expect(patch).not.toBeNull();
    expect(patch?.disabledSites).toEqual(["example.com"]);
    expect(patch?.filterGroups).toEqual({ ads: false });
    expect(patch).not.toHaveProperty("fingerprintSeed");
  });

  it("accepts a payload missing some keys (patch semantics)", () => {
    const patch = validateImportedSettings({ enabled: false });
    expect(patch).toEqual({ enabled: false });
  });

  it("ignores unknown extra keys", () => {
    const patch = validateImportedSettings({ enabled: true, someFutureField: "x" });
    expect(patch).toEqual({ enabled: true });
  });

  it("ignores fingerprintSeed even if present in the payload", () => {
    const patch = validateImportedSettings({ fingerprintSeed: "attacker-supplied" });
    expect(patch).toEqual({});
  });

  it("rejects a non-object payload", () => {
    expect(validateImportedSettings(null)).toBeNull();
    expect(validateImportedSettings("not an object")).toBeNull();
    expect(validateImportedSettings(42)).toBeNull();
  });

  it("rejects a wrong-type boolean field", () => {
    expect(validateImportedSettings({ enabled: "yes" })).toBeNull();
  });

  it("rejects a non-array disabledSites", () => {
    expect(validateImportedSettings({ disabledSites: "example.com" })).toBeNull();
    expect(validateImportedSettings({ disabledSites: [1, 2] })).toBeNull();
  });

  it("rejects a filterGroups value that isn't a boolean record", () => {
    expect(validateImportedSettings({ filterGroups: { ads: "off" } })).toBeNull();
    expect(validateImportedSettings({ filterGroups: ["ads"] })).toBeNull();
  });

  it("rejects a customCosmeticRules entry mapping to a non-array", () => {
    expect(validateImportedSettings({ customCosmeticRules: { "example.com": ".ad" } })).toBeNull();
  });
});

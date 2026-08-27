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

  it("rejects a selector containing a closing brace (could inject a whole new CSS rule)", () => {
    expect(
      validateImportedSettings({ customCosmeticRules: { "example.com": [".ad{}body{display:none}"] } })
    ).toBeNull();
  });

  it("rejects a selector containing an opening brace, angle bracket, or backtick", () => {
    for (const selector of [".ad{color:red}", "<script>", "`evil`"]) {
      expect(validateImportedSettings({ customGrayscaleRules: { "example.com": [selector] } })).toBeNull();
    }
  });

  it("accepts real selector syntax that legitimately uses '>' and other punctuation", () => {
    const patch = validateImportedSettings({ customCosmeticRules: { "example.com": ["div > .ad[data-x='1']:has(span)"] } });
    expect(patch?.customCosmeticRules).toEqual({ "example.com": ["div > .ad[data-x='1']:has(span)"] });
  });

  it("rejects an empty-string selector", () => {
    expect(validateImportedSettings({ customCosmeticRules: { "example.com": [""] } })).toBeNull();
  });

  it("rejects a selector longer than the length cap", () => {
    expect(validateImportedSettings({ customCosmeticRules: { "example.com": ["a".repeat(5000)] } })).toBeNull();
  });

  it("rejects a customBlockedDomains array longer than the length cap", () => {
    expect(validateImportedSettings({ customBlockedDomains: Array.from({ length: 5001 }, (_, i) => `d${i}.example`) })).toBeNull();
  });

  it("rejects an empty-string entry in a plain string array field", () => {
    expect(validateImportedSettings({ disabledSites: [""] })).toBeNull();
  });
});

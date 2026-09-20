import { describe, expect, it } from "vitest";
import { summarizeSettingsImport } from "./settingsDiff";
import { DEFAULT_SETTINGS, type Settings } from "../types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("summarizeSettingsImport", () => {
  it("reports isNoOp when the patch matches current settings exactly", () => {
    const current = settings({ enabled: true });
    const summary = summarizeSettingsImport(current, { enabled: true });
    expect(summary.isNoOp).toBe(true);
  });

  it("counts a single changed boolean protection setting", () => {
    const current = settings({ blockThirdPartyCookies: false });
    const summary = summarizeSettingsImport(current, { blockThirdPartyCookies: true });
    expect(summary.protectionSettingsChanged).toBe(1);
    expect(summary.isNoOp).toBe(false);
  });

  it("counts multiple changed protection settings independently", () => {
    const current = settings({ blockThirdPartyCookies: false, webrtcLeakProtection: false });
    const summary = summarizeSettingsImport(current, { blockThirdPartyCookies: true, webrtcLeakProtection: true });
    expect(summary.protectionSettingsChanged).toBe(2);
  });

  it("does not count an unchanged boolean toward protectionSettingsChanged", () => {
    const current = settings({ blockThirdPartyCookies: true });
    const summary = summarizeSettingsImport(current, { blockThirdPartyCookies: true, webrtcLeakProtection: false });
    expect(summary.protectionSettingsChanged).toBe(0);
  });

  it("flags customRulesChanged for a changed customBlockedDomains array", () => {
    const current = settings({ customBlockedDomains: [] });
    const summary = summarizeSettingsImport(current, { customBlockedDomains: ["ads.example.com"] });
    expect(summary.customRulesChanged).toBe(true);
    expect(summary.siteExceptionsChanged).toBe(false);
  });

  it("flags customRulesChanged for changed customCosmeticRules/customGrayscaleRules", () => {
    const current = settings({ customCosmeticRules: {} });
    const summary = summarizeSettingsImport(current, { customCosmeticRules: { "example.com": [".ad"] } });
    expect(summary.customRulesChanged).toBe(true);
  });

  it("flags siteExceptionsChanged for a changed disabledSites array, not customRulesChanged", () => {
    const current = settings({ disabledSites: [] });
    const summary = summarizeSettingsImport(current, { disabledSites: ["site.example.com"] });
    expect(summary.siteExceptionsChanged).toBe(true);
    expect(summary.customRulesChanged).toBe(false);
  });

  it("flags siteExceptionsChanged, not customRulesChanged, for a changed customAllowedDomains array", () => {
    // customAllowedDomains is "the opposite of a rule" -- same bucketing as
    // the Backup tab's own manifest count (renderBackupTab's bm-exceptions).
    const current = settings({ customAllowedDomains: [] });
    const summary = summarizeSettingsImport(current, { customAllowedDomains: ["shop.example.com"] });
    expect(summary.siteExceptionsChanged).toBe(true);
    expect(summary.customRulesChanged).toBe(false);
  });

  it("does not count a domain array reordering as a change (order-insensitive)", () => {
    const current = settings({ customBlockedDomains: ["a.com", "b.com"] });
    const summary = summarizeSettingsImport(current, { customBlockedDomains: ["b.com", "a.com"] });
    expect(summary.customRulesChanged).toBe(false);
  });

  it("flags filterListChoicesChanged for a changed filterGroups record", () => {
    const current = settings({ filterGroups: {} });
    const summary = summarizeSettingsImport(current, { filterGroups: { ads: true } });
    expect(summary.filterListChoicesChanged).toBe(true);
  });

  it("flags syncSettingChanged for a changed syncEnabled, and never counts it as a protection setting", () => {
    const current = settings({ syncEnabled: false });
    const summary = summarizeSettingsImport(current, { syncEnabled: true });
    expect(summary.syncSettingChanged).toBe(true);
    expect(summary.protectionSettingsChanged).toBe(0);
  });

  it("ignores a patch key not present in the payload -- only compares keys actually in the patch", () => {
    const current = settings({ blockThirdPartyCookies: true, webrtcLeakProtection: true });
    const summary = summarizeSettingsImport(current, { blockThirdPartyCookies: true });
    expect(summary.isNoOp).toBe(true);
  });

  it("reports a mix of every category at once", () => {
    const current = settings({
      blockThirdPartyCookies: false,
      customBlockedDomains: [],
      disabledSites: [],
      filterGroups: {},
      syncEnabled: false,
    });
    const summary = summarizeSettingsImport(current, {
      blockThirdPartyCookies: true,
      customBlockedDomains: ["ads.example.com"],
      disabledSites: ["paused.example.com"],
      filterGroups: { ads: true },
      syncEnabled: true,
    });
    expect(summary).toEqual({
      protectionSettingsChanged: 1,
      customRulesChanged: true,
      siteExceptionsChanged: true,
      filterListChoicesChanged: true,
      syncSettingChanged: true,
      isNoOp: false,
    });
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../types";
import { effectiveValue, OVERRIDABLE_KEYS } from "./perSiteOverrides";

function settingsWith(patch: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe("OVERRIDABLE_KEYS", () => {
  it("lists exactly the 4 content-script-enforced, per-site-scopable settings", () => {
    expect(OVERRIDABLE_KEYS).toEqual([
      "fingerprintResistance",
      "cookieBannerAutoReject",
      "aggressiveFeedAdRemoval",
      "hideSeoSpamResults",
    ]);
  });
});

describe("effectiveValue", () => {
  it("falls back to the global setting when there is no override at all", () => {
    const settings = settingsWith({ hideSeoSpamResults: true });
    expect(effectiveValue(settings, "example.com", "hideSeoSpamResults")).toBe(true);
  });

  it("falls back to the global setting when other hostnames have overrides but not this one", () => {
    const settings = settingsWith({
      hideSeoSpamResults: true,
      perSiteOverrides: { "other.com": { hideSeoSpamResults: false } },
    });
    expect(effectiveValue(settings, "example.com", "hideSeoSpamResults")).toBe(true);
  });

  it("uses an exact-hostname override over the global setting", () => {
    const settings = settingsWith({
      hideSeoSpamResults: true,
      perSiteOverrides: { "example.com": { hideSeoSpamResults: false } },
    });
    expect(effectiveValue(settings, "example.com", "hideSeoSpamResults")).toBe(false);
  });

  it("applies a parent-domain override to a subdomain", () => {
    const settings = settingsWith({
      cookieBannerAutoReject: false,
      perSiteOverrides: { "example.com": { cookieBannerAutoReject: true } },
    });
    expect(effectiveValue(settings, "shop.example.com", "cookieBannerAutoReject")).toBe(true);
  });

  it("prefers the most specific override when both a subdomain and a parent domain have one", () => {
    const settings = settingsWith({
      aggressiveFeedAdRemoval: false,
      perSiteOverrides: {
        "example.com": { aggressiveFeedAdRemoval: true },
        "shop.example.com": { aggressiveFeedAdRemoval: false },
      },
    });
    expect(effectiveValue(settings, "shop.example.com", "aggressiveFeedAdRemoval")).toBe(false);
  });

  it("ignores an override entry for the same hostname that doesn't cover the requested key", () => {
    const settings = settingsWith({
      fingerprintResistance: true,
      perSiteOverrides: { "example.com": { hideSeoSpamResults: false } },
    });
    expect(effectiveValue(settings, "example.com", "fingerprintResistance")).toBe(true);
  });
});

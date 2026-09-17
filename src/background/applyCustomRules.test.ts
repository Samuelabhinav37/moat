import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../types";
import type { DeclarativeNetRequest } from "webextension-polyfill";

const updateDynamicRules = vi.fn(
  (_options: { removeRuleIds: number[]; addRules: DeclarativeNetRequest.Rule[] }) => Promise.resolve()
);

vi.mock("webextension-polyfill", () => ({
  default: { declarativeNetRequest: { updateDynamicRules } },
}));

const { applyCustomRules } = await import("./applyCustomRules");
const { CUSTOM_BLOCK_ID_START, CUSTOM_ALLOW_ID_START } = await import("./customRules");

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

beforeEach(() => {
  updateDynamicRules.mockClear();
});

describe("applyCustomRules", () => {
  it("applies both block and allow rules in a single atomic call", async () => {
    await applyCustomRules({ ...baseSettings, customBlockedDomains: ["ads.example.com"], customAllowedDomains: ["good.example.com"] });

    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const args = updateDynamicRules.mock.calls[0]![0];
    expect(args.removeRuleIds).toContain(CUSTOM_BLOCK_ID_START);
    expect(args.removeRuleIds).toContain(CUSTOM_ALLOW_ID_START);
    expect(args.addRules.map((r) => r.id)).toEqual([CUSTOM_BLOCK_ID_START, CUSTOM_ALLOW_ID_START]);
  });

  it("does not throw when the browser API call fails", async () => {
    updateDynamicRules.mockRejectedValueOnce(new Error("quota"));
    await expect(applyCustomRules(baseSettings)).resolves.toBeUndefined();
  });

  it("never emits an allow rule for a domain in the managed-blocked list, even if the user added it to their own allow list", async () => {
    await applyCustomRules(
      { ...baseSettings, customBlockedDomains: ["tracker.com"], customAllowedDomains: ["tracker.com", "safe.com"] },
      ["tracker.com"]
    );

    const args = updateDynamicRules.mock.calls[0]![0];
    const allowFilters = args.addRules.filter((r) => r.id >= CUSTOM_ALLOW_ID_START).map((r) => r.condition.urlFilter);
    expect(allowFilters).toEqual(["||safe.com^"]);
  });
});

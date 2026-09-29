import { describe, expect, it } from "vitest";
import { siteOverrideEntries } from "./siteOverrides";

describe("siteOverrideEntries", () => {
  it("lists only sites with a real override, sorted without www., in the popup's order", () => {
    const entries = siteOverrideEntries({
      "www.zeta.example": { hideSeoSpamResults: false, fingerprintResistance: true },
      "alpha.example": { cookieBannerAutoReject: false },
      "empty.example": {},
    });
    expect(entries).toEqual([
      { hostname: "alpha.example", changes: [{ key: "cookieBannerAutoReject", value: false }] },
      {
        hostname: "www.zeta.example",
        changes: [
          { key: "fingerprintResistance", value: true },
          { key: "hideSeoSpamResults", value: false },
        ],
      },
    ]);
  });

  it("is empty when nothing was changed for any site", () => {
    expect(siteOverrideEntries({})).toEqual([]);
  });
});

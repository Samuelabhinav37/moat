import { describe, expect, it } from "vitest";
import { applySiteExceptions, parseSiteExceptions, type SiteException } from "./siteExceptions";
import { effectiveValue } from "./perSiteOverrides";
import { DEFAULT_SETTINGS, type Settings } from "../types";

const payload = (sites: unknown[]) => ({ format: 1, sites });

describe("parseSiteExceptions", () => {
  it("keeps good entries and drops bad ones on their own", () => {
    expect(
      parseSiteExceptions(
        payload([
          { site: "bank.example", off: ["fingerprintResistance"], issue: 12 },
          { site: "shop.example", allowRequests: true, issue: 13 },
          { site: "no-issue.example", allowRequests: true },
          { site: "bad.example", off: ["enabled"], issue: 14 },
          { site: "nothing.example", issue: 15 },
          { site: "1.2.3.4", allowRequests: true, issue: 16 },
        ])
      )
    ).toEqual([
      { site: "bank.example", off: ["fingerprintResistance"], allowRequests: false, issue: 12 },
      { site: "shop.example", off: [], allowRequests: true, issue: 13 },
    ]);
  });

  it("refuses anything that isn't a site-exceptions file", () => {
    expect(parseSiteExceptions({ format: 2, sites: [] })).toBeNull();
    expect(parseSiteExceptions([])).toBeNull();
  });
});

describe("applySiteExceptions", () => {
  const exception: SiteException = { site: "bank.example", off: ["fingerprintResistance"], allowRequests: false, issue: 12 };
  const strict = { ...DEFAULT_SETTINGS, fingerprintResistance: true } as Settings;

  it("turns the feature off on that site and its subdomains, nowhere else", () => {
    const s = applySiteExceptions(strict, [exception]);
    expect(effectiveValue(s, "www.bank.example", "fingerprintResistance")).toBe(false);
    expect(effectiveValue(s, "news.example", "fingerprintResistance")).toBe(true);
  });

  it("never overrides a choice you made yourself on the site or a parent of it", () => {
    const onWww = { ...exception, site: "www.bank.example" };
    for (const own of ["www.bank.example", "bank.example"]) {
      const s = applySiteExceptions({ ...strict, perSiteOverrides: { [own]: { fingerprintResistance: true } } }, [onWww]);
      expect(effectiveValue(s, "www.bank.example", "fingerprintResistance")).toBe(true);
    }
  });
});

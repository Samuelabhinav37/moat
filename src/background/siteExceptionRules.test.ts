import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));
import { SITE_EXCEPTION_ID_START, buildSiteExceptionRules } from "./siteExceptionRules";
import { QUICK_FIX_PRIORITY, SECURITY_PRIORITY_OFFSET } from "../shared/rulePriorities";

describe("buildSiteExceptionRules", () => {
  it("lets the allowRequests sites' pages load, below the danger lists", () => {
    const rules = buildSiteExceptionRules([
      { site: "shop.example", off: [], allowRequests: true, issue: 1 },
      { site: "bank.example", off: ["fingerprintResistance"], allowRequests: false, issue: 2 },
    ]);
    expect(rules).toEqual([
      { id: SITE_EXCEPTION_ID_START, priority: QUICK_FIX_PRIORITY, action: { type: "allowAllRequests" }, condition: { requestDomains: ["shop.example"], resourceTypes: ["main_frame", "sub_frame"] } },
    ]);
    expect(rules[0]!.priority).toBeLessThan(SECURITY_PRIORITY_OFFSET);
  });

  it("adds nothing when no entry allows requests", () => {
    expect(buildSiteExceptionRules([])).toEqual([]);
  });
});

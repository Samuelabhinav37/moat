import { describe, expect, it } from "vitest";
import { buildSameCompanyRules, SAME_COMPANY_PRIORITY } from "./sameCompanyRules.mjs";
import { QUICK_FIX_PRIORITY } from "../../src/shared/rulePriorities.ts";

// Enough of a public suffix list for registrableDomain().
const psl = { rules: new Set(["com", "net"]), exceptions: new Set() };
const entities = [
  ["google.com", "google-analytics.com", "youtube.com"],
  ["bing.com", "bing.net", "msn.com"],
];

describe("buildSameCompanyRules", () => {
  const rules = buildSameCompanyRules(
    ["www.google-analytics.com", "bat.bing.net", "ads.bing.net", "adservice.google.com", "pixel.bing.net", "tracker.example.net"],
    new Set(["pixel.bing.net"]),
    entities,
    psl
  );

  it("allows a company's trackers only on its own sites", () => {
    expect(rules).toEqual([
      expect.objectContaining({ id: 1, action: { type: "allow" }, condition: expect.objectContaining({ requestDomains: ["bat.bing.net"], initiatorDomains: ["bing.com", "bing.net", "msn.com"] }) }),
      expect.objectContaining({ id: 2, condition: expect.objectContaining({ requestDomains: ["www.google-analytics.com"], initiatorDomains: ["google-analytics.com", "google.com", "youtube.com"] }) }),
    ]);
  });

  it("never covers the page itself, and stays below quick fixes", () => {
    for (const rule of rules) expect(rule.condition.resourceTypes).not.toContain("main_frame");
    expect(SAME_COMPANY_PRIORITY).toBeLessThan(QUICK_FIX_PRIORITY);
    expect(SAME_COMPANY_PRIORITY).toBeGreaterThan(1_100_201);
  });
});

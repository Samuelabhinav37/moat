import { describe, expect, it } from "vitest";
import {
  allAthenaPolicyRuleIds,
  ATHENA_POLICY_ID_START,
  buildAthenaPolicyRules,
  filterValidDomains,
  MAX_ATHENA_POLICY_RULES,
  parsePolicyArtifact,
} from "./athenaPolicyRules";

describe("filterValidDomains", () => {
  it("keeps well-formed hostnames and reports how many were rejected", () => {
    const result = filterValidDomains(["evil.example", "not a domain", "sub.evil.example"]);
    expect(result.valid).toEqual(["evil.example", "sub.evil.example"]);
    expect(result.rejectedCount).toBe(1);
  });
});

describe("parsePolicyArtifact", () => {
  const validPayload = () => JSON.stringify({ version: 1, issuedAt: 1_700_000_000_000, blockedDomains: ["evil.example"] });

  it("parses a well-formed artifact", () => {
    expect(parsePolicyArtifact(validPayload())).toEqual({
      version: 1,
      issuedAt: 1_700_000_000_000,
      blockedDomains: ["evil.example"],
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parsePolicyArtifact("{not json")).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(parsePolicyArtifact(JSON.stringify({ version: 1, blockedDomains: [] }))).toBeNull();
  });

  it("returns null when blockedDomains isn't an array of strings", () => {
    expect(parsePolicyArtifact(JSON.stringify({ version: 1, issuedAt: 1, blockedDomains: [1, 2] }))).toBeNull();
  });

  it("silently drops malformed domains within an otherwise-valid artifact", () => {
    const payload = JSON.stringify({ version: 1, issuedAt: 1, blockedDomains: ["evil.example", "not a domain"] });
    expect(parsePolicyArtifact(payload)?.blockedDomains).toEqual(["evil.example"]);
  });
});

describe("buildAthenaPolicyRules", () => {
  it("builds a main_frame-only redirect rule per domain, in the reserved id range", () => {
    const rules = buildAthenaPolicyRules(["evil.example", "also-evil.example"]);
    expect(rules).toEqual([
      {
        id: ATHENA_POLICY_ID_START,
        priority: 1,
        action: { type: "redirect", redirect: { extensionPath: "/warning.html" } },
        condition: { urlFilter: "||evil.example^", resourceTypes: ["main_frame"] },
      },
      {
        id: ATHENA_POLICY_ID_START + 1,
        priority: 1,
        action: { type: "redirect", redirect: { extensionPath: "/warning.html" } },
        condition: { urlFilter: "||also-evil.example^", resourceTypes: ["main_frame"] },
      },
    ]);
  });

  it("caps at MAX_ATHENA_POLICY_RULES", () => {
    const domains = Array.from({ length: MAX_ATHENA_POLICY_RULES + 10 }, (_, i) => `d${i}.example`);
    expect(buildAthenaPolicyRules(domains)).toHaveLength(MAX_ATHENA_POLICY_RULES);
  });
});

describe("allAthenaPolicyRuleIds", () => {
  it("covers exactly the id range buildAthenaPolicyRules can produce", () => {
    const ids = allAthenaPolicyRuleIds();
    expect(ids).toHaveLength(MAX_ATHENA_POLICY_RULES);
    expect(ids[0]).toBe(ATHENA_POLICY_ID_START);
    expect(ids[ids.length - 1]).toBe(ATHENA_POLICY_ID_START + MAX_ATHENA_POLICY_RULES - 1);
  });
});

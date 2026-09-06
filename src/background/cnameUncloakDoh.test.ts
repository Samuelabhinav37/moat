import { describe, expect, it } from "vitest";
import {
  allCnameDohBlockRuleIds,
  buildCnameDohBlockRules,
  CNAME_DOH_BLOCK_ID_START,
  MAX_CNAME_DOH_RULES,
  parseDohCnameAnswer,
} from "./cnameUncloakDoh";

describe("buildCnameDohBlockRules", () => {
  it("builds one block rule per hostname covering every resource type", () => {
    const rules = buildCnameDohBlockRules(["trk.example.com"]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.action).toEqual({ type: "block" });
    expect(rules[0]?.condition.urlFilter).toBe("||trk.example.com^");
    expect(rules[0]?.condition.resourceTypes).toContain("xmlhttprequest");
  });

  it("assigns ids starting at CNAME_DOH_BLOCK_ID_START", () => {
    const rules = buildCnameDohBlockRules(["a.example.com", "b.example.com"]);
    expect(rules.map((r) => r.id)).toEqual([CNAME_DOH_BLOCK_ID_START, CNAME_DOH_BLOCK_ID_START + 1]);
  });

  it("caps at MAX_CNAME_DOH_RULES", () => {
    const hostnames = Array.from({ length: MAX_CNAME_DOH_RULES + 10 }, (_, i) => `h${i}.example.com`);
    expect(buildCnameDohBlockRules(hostnames)).toHaveLength(MAX_CNAME_DOH_RULES);
  });

  it("returns an empty array for no hostnames", () => {
    expect(buildCnameDohBlockRules([])).toEqual([]);
  });
});

describe("allCnameDohBlockRuleIds", () => {
  it("spans exactly MAX_CNAME_DOH_RULES contiguous ids from CNAME_DOH_BLOCK_ID_START", () => {
    const ids = allCnameDohBlockRuleIds();
    expect(ids).toHaveLength(MAX_CNAME_DOH_RULES);
    expect(ids[0]).toBe(CNAME_DOH_BLOCK_ID_START);
    expect(ids[ids.length - 1]).toBe(CNAME_DOH_BLOCK_ID_START + MAX_CNAME_DOH_RULES - 1);
  });

  it("stays clear of every other reserved dynamic-rule id range", () => {
    // customRules.ts 800_000 (+1000), 810_000 (+1000); liveRedirectRules.ts
    // 900_000 (+2000); quickFixRules.ts 950_000; athenaPolicyRules.ts 960_000
    // -- see cnameUncloakDoh.ts's own comment for the full list.
    expect(CNAME_DOH_BLOCK_ID_START).toBeGreaterThan(960_000);
  });
});

describe("parseDohCnameAnswer", () => {
  it("returns the CNAME target with its trailing root-label dot stripped", () => {
    expect(parseDohCnameAnswer({ Answer: [{ type: 5, data: "tracker.example.net." }] })).toBe("tracker.example.net");
  });

  it("returns null when there is no Answer array", () => {
    expect(parseDohCnameAnswer({})).toBeNull();
  });

  it("returns null when Answer has no CNAME (type 5) record", () => {
    expect(parseDohCnameAnswer({ Answer: [{ type: 1, data: "1.2.3.4" }] })).toBeNull();
  });

  it("returns null for an empty Answer array", () => {
    expect(parseDohCnameAnswer({ Answer: [] })).toBeNull();
  });

  it("picks the first CNAME record when multiple answers are present", () => {
    expect(
      parseDohCnameAnswer({
        Answer: [
          { type: 1, data: "1.2.3.4" },
          { type: 5, data: "first.example.net." },
          { type: 5, data: "second.example.net." },
        ],
      })
    ).toBe("first.example.net");
  });
});

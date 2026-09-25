import { describe, expect, it } from "vitest";
import { isBlockedByDomainChain, plainBlockedDomains } from "./blockedDomains.mjs";

const block = (condition) => ({ id: 1, action: { type: "block" }, condition });

describe("plainBlockedDomains", () => {
  it("reads bare domain anchors and requestDomains", () => {
    const domains = plainBlockedDomains([
      block({ urlFilter: "||ads.example^" }),
      block({ requestDomains: ["tracker.example", "Other.Example"] }),
    ]);
    expect([...domains].sort()).toEqual(["ads.example", "other.example", "tracker.example"]);
  });

  it("skips rules that block less than every request to the domain", () => {
    const domains = plainBlockedDomains([
      block({ urlFilter: "||a.example^", initiatorDomains: ["site.example"] }),
      block({ urlFilter: "||b.example^", domainType: "thirdParty" }),
      block({ urlFilter: "||c.example/path" }),
      block({ urlFilter: "||d.example^", resourceTypes: ["script"] }),
      { id: 2, action: { type: "allow" }, condition: { urlFilter: "||e.example^" } },
    ]);
    expect([...domains]).toEqual([]);
  });

  it("counts resourceTypes-limited rules only when asked to", () => {
    const rules = [block({ urlFilter: "||d.example^", resourceTypes: ["script"] })];
    expect([...plainBlockedDomains(rules, { allowResourceTypes: true })]).toEqual(["d.example"]);
  });
});

describe("isBlockedByDomainChain", () => {
  const blocked = new Set(["tracker.example"]);

  it("matches the domain itself and its subdomains", () => {
    expect(isBlockedByDomainChain("tracker.example", blocked)).toBe(true);
    expect(isBlockedByDomainChain("a.b.tracker.example", blocked)).toBe(true);
  });

  it("doesn't match lookalikes or a bare TLD", () => {
    expect(isBlockedByDomainChain("nottracker.example", blocked)).toBe(false);
    expect(isBlockedByDomainChain("example", new Set(["example"]))).toBe(false);
  });
});

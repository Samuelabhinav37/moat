import { describe, expect, it } from "vitest";
import { packableDomain, packDomainRules } from "./packDomainRules.mjs";

const block = (id, urlFilter, extra = {}, priority) => ({
  id,
  action: { type: "block" },
  condition: { urlFilter, ...extra },
  ...(priority !== undefined ? { priority } : {}),
});

describe("packableDomain", () => {
  it("takes plain ||domain^ blocks", () => {
    expect(packableDomain(block(1, "||ads.example.com^"))).toBe("ads.example.com");
    expect(packableDomain(block(1, "||x-y.co.uk^", { resourceTypes: ["script"] }))).toBe("x-y.co.uk");
    expect(packableDomain(block(1, "||t.example^", { domainType: "thirdParty" }))).toBe("t.example");
  });

  it("leaves anything that blocks less, or differently, alone", () => {
    expect(packableDomain(block(1, "||example.com/ads^"))).toBeNull();
    expect(packableDomain(block(1, "||example.com^$third-party"))).toBeNull();
    expect(packableDomain(block(1, "example.com"))).toBeNull();
    expect(packableDomain(block(1, "||example.com^", { initiatorDomains: ["a.com"] }))).toBeNull();
    expect(packableDomain(block(1, "||example.com^", { isUrlFilterCaseSensitive: true }))).toBeNull();
    expect(packableDomain(block(1, "||1.2.3.4^"))).toBeNull();
    expect(packableDomain({ id: 1, action: { type: "allow" }, condition: { urlFilter: "||example.com^" } })).toBeNull();
    expect(packableDomain({ id: 1, action: { type: "redirect", redirect: { extensionPath: "/x.js" } }, condition: { urlFilter: "||example.com^" } })).toBeNull();
  });
});

describe("packDomainRules", () => {
  it("packs same-shaped domain blocks into requestDomains rules and keeps every other rule as it was", () => {
    const other = { id: 3, action: { type: "allow" }, condition: { urlFilter: "||good.example^" }, priority: 2 };
    const { rules, packedFrom, packedInto } = packDomainRules([
      block(1, "||b.example^"),
      block(2, "||a.example^"),
      other,
      block(4, "||c.example/path"),
    ]);
    expect(packedFrom).toBe(2);
    expect(packedInto).toBe(1);
    expect(rules).toContainEqual(other);
    expect(rules).toContainEqual(block(4, "||c.example/path"));
    const packed = rules.find((r) => r.condition.requestDomains);
    expect(packed).toEqual({ id: 5, action: { type: "block" }, condition: { requestDomains: ["a.example", "b.example"] } });
  });

  it("never mixes rules that differ in types, scope or priority", () => {
    const { rules } = packDomainRules([
      block(1, "||a.example^"),
      block(2, "||b.example^", { resourceTypes: ["script", "image"] }),
      block(3, "||c.example^", { resourceTypes: ["image", "script"] }),
      block(4, "||d.example^", { domainType: "thirdParty" }),
      block(5, "||e.example^", {}, 2000001),
      block(6, "||f.example^", {}, 2000001),
    ]);
    const packed = rules.filter((r) => r.condition.requestDomains);
    const byDomains = Object.fromEntries(packed.map((r) => [r.condition.requestDomains.join(","), r]));
    expect(Object.keys(byDomains).sort()).toEqual(["a.example", "b.example,c.example", "d.example", "e.example,f.example"]);
    expect(byDomains["b.example,c.example"].condition.resourceTypes).toEqual(["script", "image"]);
    expect(byDomains["d.example"].condition.domainType).toBe("thirdParty");
    expect(byDomains["e.example,f.example"].priority).toBe(2000001);
    expect(byDomains["a.example"].priority).toBeUndefined();
  });

  it("leaves rules a company is attributed to unpacked, with their ids", () => {
    const { rules } = packDomainRules([block(1, "||google.example^"), block(2, "||x.example^")], { keepIds: new Set([1]) });
    expect(rules).toContainEqual(block(1, "||google.example^"));
    expect(rules.find((r) => r.condition.requestDomains).condition.requestDomains).toEqual(["x.example"]);
  });

  it("splits a big group, drops duplicate domains, and gives new ids after the highest one", () => {
    const input = [
      ...Array.from({ length: 5 }, (_, i) => block(10 + i, `||d${i}.example^`)),
      block(99, "||d0.example^"),
    ];
    const { rules, packedFrom } = packDomainRules(input, { perRule: 2 });
    const packed = rules.filter((r) => r.condition.requestDomains);
    expect(packedFrom).toBe(5);
    expect(packed.map((r) => r.condition.requestDomains.length)).toEqual([2, 2, 1]);
    expect(packed.map((r) => r.id)).toEqual([100, 101, 102]);
  });

  it("is a no-op on an already-packed ruleset", () => {
    const once = packDomainRules([block(1, "||a.example^"), block(2, "||b.example^")]).rules;
    expect(packDomainRules(once).rules).toEqual(once);
  });
});

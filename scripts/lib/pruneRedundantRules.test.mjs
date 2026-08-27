import { describe, expect, it } from "vitest";
import { pruneRedundantRules } from "./pruneRedundantRules.mjs";

function blockRule(id, urlFilter, resourceTypes = ["script"], extra = {}) {
  return { id, action: { type: "block" }, condition: { urlFilter, resourceTypes, ...extra } };
}

describe("pruneRedundantRules", () => {
  it("drops a child-domain rule already covered by an ancestor-domain rule with the same resourceTypes", () => {
    const rules = [blockRule(1, "||example.com^"), blockRule(2, "||track.example.com^")];
    const { kept, droppedCount } = pruneRedundantRules(rules);
    expect(kept).toEqual([rules[0]]);
    expect(droppedCount).toBe(1);
  });

  it("keeps both rules when resourceTypes differ -- the ancestor doesn't cover the same scope", () => {
    const rules = [blockRule(1, "||example.com^", ["image"]), blockRule(2, "||track.example.com^", ["script"])];
    const { kept, droppedCount } = pruneRedundantRules(rules);
    expect(kept).toEqual(rules);
    expect(droppedCount).toBe(0);
  });

  it("keeps a rule with any extra condition key untouched, even if it looks redundant", () => {
    const rules = [
      blockRule(1, "||example.com^"),
      blockRule(2, "||track.example.com^", ["script"], { initiatorDomains: ["other.com"] }),
    ];
    const { kept, droppedCount } = pruneRedundantRules(rules);
    expect(kept).toEqual(rules);
    expect(droppedCount).toBe(0);
  });

  it("never touches non-block actions (allow/modifyHeaders/redirect)", () => {
    const allowRule = { id: 2, action: { type: "allow" }, condition: { urlFilter: "||track.example.com^" } };
    const rules = [blockRule(1, "||example.com^"), allowRule];
    const { kept, droppedCount } = pruneRedundantRules(rules);
    expect(kept).toEqual(rules);
    expect(droppedCount).toBe(0);
  });

  it("drops every rule covered by any ancestor in the chain, not just an immediate parent", () => {
    // a.b.example.com has ancestors b.example.com and example.com -- both present.
    const rules = [
      blockRule(1, "||example.com^"),
      blockRule(2, "||b.example.com^"),
      blockRule(3, "||a.b.example.com^"),
    ];
    const { kept, droppedCount } = pruneRedundantRules(rules);
    expect(kept).toEqual([rules[0]]); // both 2 and 3 are covered by rule 1
    expect(droppedCount).toBe(2);
  });

  it("does not drop unrelated domains from each other", () => {
    const rules = [blockRule(1, "||example.com^"), blockRule(2, "||other-example.com^")];
    const { kept, droppedCount } = pruneRedundantRules(rules);
    expect(kept).toEqual(rules);
    expect(droppedCount).toBe(0);
  });

  it("preserves original order and ids of kept rules", () => {
    const rules = [blockRule(5, "||z.example.com^"), blockRule(1, "||example.com^"), blockRule(9, "||other.com^")];
    const { kept } = pruneRedundantRules(rules);
    expect(kept.map((r) => r.id)).toEqual([1, 9]);
  });

  it("returns everything unchanged when nothing is redundant", () => {
    const rules = [blockRule(1, "||a.com^"), blockRule(2, "||b.com^"), blockRule(3, "||c.com^")];
    const { kept, droppedCount } = pruneRedundantRules(rules);
    expect(kept).toEqual(rules);
    expect(droppedCount).toBe(0);
  });

  describe("semantic equivalence: the pruned set blocks exactly the same requests as the original", () => {
    // Mirrors declarativeNetRequest's own "||domain^" anchor semantics:
    // matches the domain itself and any subdomain of it, scoped to the
    // rule's resourceTypes.
    function blocks(rules, hostname, resourceType) {
      return rules.some((r) => {
        if (r.action?.type !== "block") return false;
        const domain = /^\|\|([a-z0-9.-]+)\^$/.exec(r.condition.urlFilter)?.[1];
        if (!domain) return false;
        if (!(r.condition.resourceTypes ?? []).includes(resourceType)) return false;
        return hostname === domain || hostname.endsWith("." + domain);
      });
    }

    it("agrees with the original rule set for every request a sample ruleset actually covers", () => {
      const rules = [
        blockRule(1, "||adnetwork.example^", ["script", "image"]),
        blockRule(2, "||a.adnetwork.example^", ["script", "image"]), // redundant, dropped
        blockRule(3, "||b.adnetwork.example^", ["image"]), // NOT redundant -- narrower resourceTypes
        blockRule(4, "||standalone-tracker.example^", ["xmlhttprequest"]),
        blockRule(5, "||nested.a.adnetwork.example^", ["script", "image"]), // redundant via rule 1
      ];
      const { kept, droppedCount } = pruneRedundantRules(rules);
      expect(droppedCount).toBe(2);

      const requests = [
        ["adnetwork.example", "script"],
        ["a.adnetwork.example", "script"],
        ["a.adnetwork.example", "image"],
        ["b.adnetwork.example", "image"],
        ["b.adnetwork.example", "script"], // only rule 1/2 (script) would cover this via ancestor, not rule 3
        ["deep.b.adnetwork.example", "script"],
        ["standalone-tracker.example", "xmlhttprequest"],
        ["nested.a.adnetwork.example", "image"],
        ["unrelated.example", "script"],
      ];
      for (const [hostname, resourceType] of requests) {
        expect(blocks(kept, hostname, resourceType)).toBe(blocks(rules, hostname, resourceType));
      }
    });
  });
});

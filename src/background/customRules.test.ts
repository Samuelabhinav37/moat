import { describe, expect, it } from "vitest";
import {
  allCustomAllowRuleIds,
  allCustomBlockRuleIds,
  buildCustomAllowRules,
  buildCustomBlockRules,
  CUSTOM_ALLOW_ID_START,
  CUSTOM_BLOCK_ID_START,
  MAX_CUSTOM_RULES_PER_LIST,
  DOMAINS_PER_RULE,
  buildPauseRule,
  buildManagedBlockRules,
  PAUSE_RULE_ID,
} from "./customRules";
import {
  BUNDLED_NON_SECURITY_MAX_PRIORITY,
  ENTERPRISE_PRIORITY,
  NEVER_BLOCK_PRIORITY,
  PAUSE_PRIORITY,
  SECURITY_PRIORITY_OFFSET,
} from "../shared/rulePriorities";

/** Every domain a set of packed rules covers, in order. */
const domainsOf = (rules: { condition: { requestDomains?: string[] } }[]) => rules.flatMap((r) => r.condition.requestDomains ?? []);

describe("buildCustomBlockRules", () => {
  it("builds a block rule covering the domain (and its subdomains) for every resource type", () => {
    const rules = buildCustomBlockRules(["a.com"]);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.action).toEqual({ type: "block" });
    expect(rules[0]?.condition.requestDomains).toEqual(["a.com"]);
    expect(rules[0]?.condition.resourceTypes).toContain("main_frame");
    expect(rules[0]?.condition.resourceTypes).toContain("xmlhttprequest");
  });

  it("packs domains into rules of DOMAINS_PER_RULE, ids from CUSTOM_BLOCK_ID_START", () => {
    const domains = Array.from({ length: 2000 }, (_, i) => `d${i}.com`);
    const rules = buildCustomBlockRules(domains);
    expect(rules).toHaveLength(2000 / DOMAINS_PER_RULE);
    expect(rules.map((r) => r.id)).toEqual([0, 1, 2, 3].map((i) => CUSTOM_BLOCK_ID_START + i));
    expect(domainsOf(rules)).toEqual(domains);
  });

  it("no longer drops domains past 1,000 (the old one-rule-per-domain cap)", () => {
    const domains = Array.from({ length: 1500 }, (_, i) => `d${i}.com`);
    expect(domainsOf(buildCustomBlockRules(domains))).toContain("d1499.com");
  });

  it("drops duplicates", () => {
    expect(domainsOf(buildCustomBlockRules(["a.com", "a.com", "b.com"]))).toEqual(["a.com", "b.com"]);
  });

  it("skips a malformed entry instead of letting it break the whole batch", () => {
    const rules = buildCustomBlockRules(["a.com", "not a domain", "https://b.com/path", "", "c.com"]);
    expect(domainsOf(rules)).toEqual(["a.com", "c.com"]);
  });

  it("still rejects a domain with a port, path, or credentials attached", () => {
    const rules = buildCustomBlockRules(["example.com:8080", "example.com/path", "user@example.com"]);
    expect(rules).toHaveLength(0);
  });

  it("converts an internationalized domain to its punycode form instead of dropping it", () => {
    const rules = buildCustomBlockRules(["münchen.de"]);
    expect(domainsOf(rules)).toEqual(["xn--mnchen-3ya.de"]);
  });
});

describe("buildCustomAllowRules", () => {
  it("builds an allow rule with higher priority than a block rule, so it wins", () => {
    const [blockRule] = buildCustomBlockRules(["a.com"]);
    const [allowRule] = buildCustomAllowRules(["a.com"]);
    expect(allowRule?.action).toEqual({ type: "allow" });
    expect(allowRule!.priority!).toBeGreaterThan(blockRule!.priority!);
  });

  it("uses a completely separate id range from block rules", () => {
    const blockIds = new Set(buildCustomBlockRules(["a.com"]).map((r) => r.id));
    const allowIds = new Set(buildCustomAllowRules(["a.com"]).map((r) => r.id));
    for (const id of allowIds) expect(blockIds.has(id)).toBe(false);
  });

  describe("neverAllow (the enterprise-managed block list)", () => {
    it("drops an allow entry that exactly matches a managed-blocked domain", () => {
      const rules = buildCustomAllowRules(["tracker.com"], ["tracker.com"]);
      expect(rules).toHaveLength(0);
    });

    it("drops an allow entry for a subdomain of a managed-blocked domain", () => {
      const rules = buildCustomAllowRules(["sub.tracker.com"], ["tracker.com"]);
      expect(rules).toHaveLength(0);
    });

    it("drops an allow entry for the PARENT of a managed-blocked domain too", () => {
      // The reverse-direction gap: ||example.com^ matches every subdomain,
      // so allow-listing the parent would otherwise silently reopen a
      // managed block on a specific subdomain it doesn't even mention.
      const rules = buildCustomAllowRules(["example.com"], ["ads.example.com"]);
      expect(rules).toHaveLength(0);
    });

    it("drops a parent allow entry even when it's several labels above the managed-blocked domain", () => {
      const rules = buildCustomAllowRules(["example.com"], ["deep.sub.ads.example.com"]);
      expect(rules).toHaveLength(0);
    });

    it("keeps an allow entry unrelated to any managed-blocked domain", () => {
      const rules = buildCustomAllowRules(["safe.com"], ["tracker.com"]);
      expect(domainsOf(rules)).toEqual(["safe.com"]);
    });

    it("keeps every allow entry when neverAllow is empty or omitted, unchanged from before", () => {
      expect(buildCustomAllowRules(["a.com"], [])).toHaveLength(1);
      expect(buildCustomAllowRules(["a.com"])).toHaveLength(1);
    });

    it("does not filter out a user's own customBlockedDomains entry -- only the managed list is enforced here", () => {
      // A user allowing back their own earlier block entry is this list's
      // documented, intended use (see buildCustomAllowRules's own comment) --
      // neverAllow only ever receives the managed list, never the user's own
      // customBlockedDomains, so this is really asserting the function has no
      // opinion about domains it was never told to exclude.
      const rules = buildCustomAllowRules(["own-choice.com"], []);
      expect(rules).toHaveLength(1);
    });
  });
});

describe("id range helpers", () => {
  it("allCustomBlockRuleIds covers exactly what buildCustomBlockRules can produce at the cap", () => {
    const domains = Array.from({ length: MAX_CUSTOM_RULES_PER_LIST * DOMAINS_PER_RULE }, (_, i) => `d${i}.com`);
    const builtIds = new Set(buildCustomBlockRules(domains).map((r) => r.id));
    expect(new Set(allCustomBlockRuleIds())).toEqual(builtIds);
  });

  it("allCustomAllowRuleIds does not overlap allCustomBlockRuleIds", () => {
    const blockIds = new Set(allCustomBlockRuleIds());
    const allowIds = new Set(allCustomAllowRuleIds());
    expect(CUSTOM_ALLOW_ID_START).toBeGreaterThanOrEqual(CUSTOM_BLOCK_ID_START + MAX_CUSTOM_RULES_PER_LIST);
    for (const id of allowIds) expect(blockIds.has(id)).toBe(false);
  });
});

describe("priority bands", () => {
  it("rank bundled ads < Never block < pause < bundled security < enterprise", () => {
    expect(BUNDLED_NON_SECURITY_MAX_PRIORITY).toBeLessThan(NEVER_BLOCK_PRIORITY);
    expect(NEVER_BLOCK_PRIORITY).toBeLessThan(PAUSE_PRIORITY);
    // A security rule at the lowest possible priority (1) still beats a pause.
    expect(1 + SECURITY_PRIORITY_OFFSET).toBeGreaterThan(PAUSE_PRIORITY);
    expect(ENTERPRISE_PRIORITY).toBeGreaterThan(SECURITY_PRIORITY_OFFSET + BUNDLED_NON_SECURITY_MAX_PRIORITY);
  });
});

describe("buildPauseRule", () => {
  it("allows everything on every paused site with one rule, at the pause priority", () => {
    expect(buildPauseRule(["paused.example", "other.example"])).toEqual({
      id: PAUSE_RULE_ID,
      priority: PAUSE_PRIORITY,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: ["paused.example", "other.example"], resourceTypes: ["main_frame", "sub_frame"] },
    });
  });

  it("returns null when nothing is paused", () => {
    expect(buildPauseRule([])).toBeNull();
  });

  it("drops malformed entries and duplicates rather than failing the whole update", () => {
    expect(buildPauseRule(["https://bad.example/path", "ok.example", "OK.example"])?.condition.requestDomains).toEqual(["ok.example"]);
    expect(buildPauseRule(["not a domain"])).toBeNull();
  });
});

describe("buildManagedBlockRules", () => {
  it("blocks at the enterprise priority, above any pause or Never block entry", () => {
    const [rule] = buildManagedBlockRules(["banned.example"]);
    expect(rule?.priority).toBe(ENTERPRISE_PRIORITY);
    expect(rule?.action.type).toBe("block");
    expect(rule?.condition.requestDomains).toEqual(["banned.example"]);
  });
});

describe("buildCustomAllowRules priority", () => {
  it("beats every bundled ad/tracker rule but stays below the security lists", () => {
    const [rule] = buildCustomAllowRules(["site.example"]);
    expect(rule?.priority).toBe(NEVER_BLOCK_PRIORITY);
    expect(rule!.priority).toBeGreaterThan(BUNDLED_NON_SECURITY_MAX_PRIORITY);
    expect(rule!.priority).toBeLessThan(1 + SECURITY_PRIORITY_OFFSET);
  });
});

// Reads the plain "block this domain and its subdomains" rules out of a DNR
// ruleset. Shared by the build (scripts/lib/blockedDomains.mjs re-exports
// it) and by CNAME uncloaking (background/cnameDestinations.ts), which
// re-applies the tracker and ad lists to an uncloaked name. Until 0.11.283
// the build wrote those lists' domains to rules/uncloak-domains.json, a
// 3.7 MB copy of data already in the package; now uncloaking reads the
// rulesets themselves, only once someone turns it on.
//
// Only rules whose whole condition is a domain match count. Anything with
// initiatorDomains, excludedResourceTypes, a path, etc. blocks less than
// "every request to this domain", so it's skipped.

const SIMPLE_URL_FILTER = /^\|\|([a-z0-9.-]+)\^$/;

export interface DnrRuleLike {
  action?: { type?: string };
  condition?: Record<string, unknown> & { urlFilter?: string; requestDomains?: string[]; domainType?: string };
}

export interface PlainBlockedOptions {
  /** Also count rules limited to a resourceTypes list. Off for pruning (such
   * a rule may block fewer request types than the rule being pruned); on for
   * uncloaking, where "this domain is a known tracker" is the only question. */
  allowResourceTypes?: boolean;
  /** Also count rules limited to third-party requests. For
   * scripts/lib/pbTrackerRules.mjs, whose own rules are third-party only, so
   * such a rule already covers them. */
  allowThirdParty?: boolean;
}

export function plainBlockedDomains(rules: readonly DnrRuleLike[], { allowResourceTypes = false, allowThirdParty = false }: PlainBlockedOptions = {}): Set<string> {
  const allowedKeys = new Set(["urlFilter", "requestDomains", ...(allowResourceTypes ? ["resourceTypes"] : [])]);
  const domains = new Set<string>();
  for (const rule of rules) {
    if (rule.action?.type !== "block") continue;
    const condition = rule.condition ?? {};
    const thirdPartyOnly = allowThirdParty && condition.domainType === "thirdParty";
    if (Object.keys(condition).some((key) => !allowedKeys.has(key) && !(thirdPartyOnly && key === "domainType"))) continue;
    if (condition.urlFilter !== undefined) {
      const match = SIMPLE_URL_FILTER.exec(condition.urlFilter);
      // A urlFilter that isn't a bare domain anchor narrows the rule, even
      // alongside requestDomains.
      if (!match) continue;
      domains.add(match[1]!.toLowerCase());
    }
    for (const domain of condition.requestDomains ?? []) domains.add(domain.toLowerCase());
  }
  return domains;
}

/** True when `domain`, or any parent of it, is in `blocked`. */
export function isBlockedByDomainChain(domain: string, blocked: ReadonlySet<string>): boolean {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

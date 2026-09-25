// Reads the plain "block this domain and its subdomains" rules out of a DNR
// ruleset. Two users:
// - update-filters.mjs prunes oisd domains the `ads` group already blocks, so
//   the Standard preset fits Chrome's static-rule limit (see the oisd section).
// - update-filters.mjs writes uncloak-domains.json, the tracker/ad domains
//   CNAME uncloaking checks a disguised subdomain's real address against.
//
// Only rules whose whole condition is a domain match count. Anything with
// initiatorDomains, domainType, excludedResourceTypes, a path, etc. blocks
// less than "every request to this domain", so it's skipped.

const SIMPLE_URL_FILTER = /^\|\|([a-z0-9.-]+)\^$/;

/**
 * @param {object[]} rules - one ruleset's DNR rules.
 * @param {object} [opts]
 * @param {boolean} [opts.allowResourceTypes] - also count rules limited to a
 *   resourceTypes list. Off for pruning (such a rule may block fewer request
 *   types than the rule being pruned); on for uncloaking, where "this domain
 *   is a known tracker" is the only question.
 * @returns {Set<string>}
 */
export function plainBlockedDomains(rules, { allowResourceTypes = false } = {}) {
  const allowedKeys = new Set(["urlFilter", "requestDomains", ...(allowResourceTypes ? ["resourceTypes"] : [])]);
  const domains = new Set();
  for (const rule of rules) {
    if (rule.action?.type !== "block") continue;
    const condition = rule.condition ?? {};
    if (Object.keys(condition).some((key) => !allowedKeys.has(key))) continue;
    if (condition.urlFilter !== undefined) {
      const match = SIMPLE_URL_FILTER.exec(condition.urlFilter);
      // A urlFilter that isn't a bare domain anchor narrows the rule, even
      // alongside requestDomains.
      if (!match) continue;
      domains.add(match[1].toLowerCase());
    }
    for (const domain of condition.requestDomains ?? []) domains.add(domain.toLowerCase());
  }
  return domains;
}

/** True when `domain`, or any parent of it, is in `blocked`. */
export function isBlockedByDomainChain(domain, blocked) {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

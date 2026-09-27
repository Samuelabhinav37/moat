// Packs a ruleset's plain "block this domain" rules into a few rules that
// each list many domains.
//
// Chrome's static-rule limit (330,000, shared by every extension) counts
// rules, not domains, and about three quarters of Moat's rules are
// `||domain^` blocks, one domain each. `condition.requestDomains` matches a
// request to a listed domain or any subdomain of it -- exactly what
// `||domain^` matches -- so one rule can carry thousands of them with no
// change in what gets blocked. uBlock Origin Lite ships its lists this way.
//
// Only rules whose whole meaning is "block requests to this domain" are
// packed, and only with others that are identical apart from the domain:
// same resourceTypes / excludedResourceTypes / domainType / priority. Every
// other rule (paths, initiators, exceptions, redirects, header edits) is
// left exactly as it was, with its id. So are rules listed in `keepIds`:
// the ones a company is attributed to (rule-companies.json), since
// getMatchedRules only reports a rule id, and a packed rule can't say which
// of its domains matched. scripts/check-rule-packing.mjs proves the packed
// and unpacked builds block the same things.

const PLAIN_DOMAIN = /^\|\|([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\^$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const PACKABLE_KEYS = new Set(["urlFilter", "resourceTypes", "excludedResourceTypes", "domainType"]);

/** Domains per packed rule. A rule with only a domain list and no URL
 * pattern can't go in Chrome's pattern index, so Chrome checks each such
 * rule on every request (the domain lookup inside one is a binary search,
 * cheap at any length). So: as few packed rules as possible. Measured with
 * scripts/benchmark/rules-cost.mjs, 50,000 lookups: unpacked 7.6 s,
 * 500 per rule 16.8 s, 5,000 per rule 9.5 s, 50,000 per rule 7.8 s. No
 * group within one ruleset file is larger than this, so it's effectively
 * one rule per group. */
export const DOMAINS_PER_PACKED_RULE = 50000;

/** The domain a rule blocks, when that's all it does; otherwise null. */
export function packableDomain(rule) {
  if (rule.action?.type !== "block") return null;
  const condition = rule.condition ?? {};
  if (Object.keys(condition).some((key) => !PACKABLE_KEYS.has(key))) return null;
  if (condition.isUrlFilterCaseSensitive) return null;
  const match = PLAIN_DOMAIN.exec(condition.urlFilter ?? "");
  if (!match) return null;
  const domain = match[1];
  // requestDomains wants host names; leave IP-address rules as they are.
  if (IPV4.test(domain)) return null;
  return domain;
}

function groupKey(rule) {
  const c = rule.condition;
  const sorted = (list) => (list ? [...list].sort().join(",") : "-");
  return [sorted(c.resourceTypes), sorted(c.excludedResourceTypes), c.domainType ?? "-", rule.priority ?? 1].join("|");
}

/**
 * @param {object[]} rules - one ruleset's DNR rules.
 * @param {object} [opts]
 * @param {Set<number>} [opts.keepIds] - rule ids to leave unpacked.
 * @param {number} [opts.perRule]
 * @returns {{ rules: object[], packedFrom: number, packedInto: number }}
 */
export function packDomainRules(rules, { keepIds = new Set(), perRule = DOMAINS_PER_PACKED_RULE } = {}) {
  const kept = [];
  const groups = new Map();
  for (const rule of rules) {
    const domain = keepIds.has(rule.id) ? null : packableDomain(rule);
    if (!domain) {
      kept.push(rule);
      continue;
    }
    const key = groupKey(rule);
    let group = groups.get(key);
    if (!group) {
      group = { template: rule, domains: new Set() };
      groups.set(key, group);
    }
    group.domains.add(domain);
  }

  let nextId = rules.reduce((max, rule) => Math.max(max, rule.id), 0) + 1;
  const packed = [];
  let packedFrom = 0;
  for (const { template, domains } of groups.values()) {
    const list = [...domains].sort();
    packedFrom += list.length;
    const { urlFilter: _drop, ...rest } = template.condition;
    for (let i = 0; i < list.length; i += perRule) {
      const rule = {
        id: nextId++,
        action: { type: "block" },
        condition: { ...rest, requestDomains: list.slice(i, i + perRule) },
      };
      if (template.priority !== undefined) rule.priority = template.priority;
      packed.push(rule);
    }
  }
  return { rules: [...kept, ...packed], packedFrom, packedInto: packed.length };
}

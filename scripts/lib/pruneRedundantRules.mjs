// Drops DNR rules that are already fully redundant: a rule blocking
// "sub.example.com" contributes nothing extra once another rule in the
// same list already blocks an ancestor domain ("example.com") with an
// equal resourceTypes set -- declarativeNetRequest's own "||" domain
// anchor already matches every subdomain of a blocked domain, so the
// child rule can never fire on a request the parent wouldn't already
// have blocked. Verified as a real, zero-risk win via
// scripts/analysis/consolidation-audit.mjs (Finding 1): ~1.9% of simple
// domain-block rules across Moat's bundled ad/tracker rulesets, almost
// entirely concentrated in one file. See
// docs/research/dnr-rule-consolidation-audit.md for the full audit this
// automates -- deliberately only that audit's "already redundant" finding,
// never its riskier sibling-subdomain consolidation (Finding 2), which
// stays a manual/reviewed process (see
// scripts/analysis/consolidation-candidates-reviewed.mjs), not something
// this build step ever applies on its own.

const SIMPLE_BLOCK = /^\|\|([a-z0-9.-]+)\^$/;

function resourceTypesKey(condition) {
  return [...(condition.resourceTypes ?? [])].sort().join(",");
}

/** Only rules whose entire condition is "block this exact domain (+
 * subdomains) for these resource types" qualify -- anything with
 * initiatorDomains/excludedInitiatorDomains/domainType/etc. has extra
 * semantics a domain-only redundancy check can't safely reason about, so
 * those are always kept untouched, never evaluated for redundancy. */
function isSimpleDomainBlock(rule) {
  if (rule.action?.type !== "block") return false;
  const condition = rule.condition ?? {};
  const extraKeys = Object.keys(condition).filter((k) => k !== "urlFilter" && k !== "resourceTypes");
  if (extraKeys.length > 0) return false;
  return SIMPLE_BLOCK.test(condition.urlFilter ?? "");
}

/**
 * @param {object[]} rules
 * @returns {{ kept: object[], droppedCount: number }} `kept` is `rules`
 *   with already-redundant simple domain-block rules removed, in their
 *   original order. Everything that isn't a "simple" rule (see above) is
 *   always kept, regardless of what else is in the list.
 */
export function pruneRedundantRules(rules) {
  const simple = [];
  for (const rule of rules) {
    if (!isSimpleDomainBlock(rule)) continue;
    const domain = SIMPLE_BLOCK.exec(rule.condition.urlFilter)[1];
    simple.push({ rule, domain, key: resourceTypesKey(rule.condition) });
  }

  // resourceTypesKey -> Set<domain> already blocked under that exact key,
  // scoped this way so a rule is only ever considered "covered" by another
  // rule that blocks at least as much (same resourceTypes) -- never a
  // narrower one.
  const domainsByKey = new Map();
  for (const entry of simple) {
    if (!domainsByKey.has(entry.key)) domainsByKey.set(entry.key, new Set());
    domainsByKey.get(entry.key).add(entry.domain);
  }

  // A Set of rule OBJECTS, not ids: `rules` is assumed to carry unique ids,
  // but that assumption living here too (via `redundantIds.has(r.id)`) meant
  // an upstream id-collision bug elsewhere in the ruleset-generation
  // pipeline would silently drop every rule sharing that id, including
  // ones that were never actually redundant -- the worst failure mode for
  // a blocker (a real ad/tracker rule vanishing with zero warning). Object
  // identity has no such assumption: only the exact rule objects this
  // function itself determined redundant are ever removed.
  const redundantRules = new Set();
  for (const entry of simple) {
    const domains = domainsByKey.get(entry.key);
    const labels = entry.domain.split(".");
    for (let i = 1; i < labels.length; i++) {
      const ancestor = labels.slice(i).join(".");
      if (domains.has(ancestor)) {
        redundantRules.add(entry.rule);
        break;
      }
    }
  }

  return { kept: rules.filter((r) => !redundantRules.has(r)), droppedCount: redundantRules.size };
}

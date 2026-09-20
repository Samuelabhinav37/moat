// Collapses many individually-blocked subdomains of one registrable domain
// into a single `||domain^` apex rule, but ONLY for the small, hand-reviewed
// allowlist below -- never automatically, and never for anything just
// because it has a lot of siblings or a TrackerDB match. This is Finding 2
// from docs/research/dnr-rule-consolidation-audit.md, which that doc and
// scripts/analysis/consolidation-candidates-reviewed.mjs both deliberately
// left as "manual, reviewed decision per domain, not an automatic build
// step" -- this file is that manual decision, recorded in code instead of
// left undone.
//
// Why the allowlist is 4 domains, not the 35 consolidation-candidates-
// reviewed.mjs originally listed: TrackerDB confirming "one company owns
// this domain" turns out to be close to the WRONG signal for safety here.
// Checked directly against the real sibling rules for many of those 35
// (paypal.com, spotify.com, reddit.com, mail.ru, adobe.com, apple.com, and
// more): every sibling is a tracking/pixel/beacon subdomain
// (t.paypal.com, pixel.spotify.com, an.mail.ru, ...), which is exactly why
// "no rule blocks the apex today" -- the apex domain is the company's own
// primary consumer-facing site (checkout.paypal.com, open.spotify.com,
// www.reddit.com, e.mail.ru webmail, id.apple.com), which nothing blocks
// today for good reason. Consolidating to `||domain^` wouldn't just save
// rules -- it would newly block the primary site itself for every Moat
// user, since `||domain^` matches every subdomain including ones that
// don't exist as separate rules yet. That's a severe regression, not an
// optimization. Two more of the 35 (b-cdn.net, fr.cdn.cloudflare.net) are
// shared CDN platforms, not single-owner domains at all -- the same
// shared-hosting trap the audit doc's own "Why the real Public Suffix
// List matters" section already warned about for blogspot.com/github.io,
// just not caught by the PSL for these two.
//
// The 4 domains here passed a stricter bar: real, standalone tracking/tag-
// delivery infrastructure with no legitimate site a user would ever
// navigate to directly at the bare domain.
//   - en25.com: Oracle Eloqua's dedicated marketing-tracking pixel domain.
//   - ensighten.com: a tag-management vendor's script-delivery domain
//     (its own siblings are literally other companies' tag configs, e.g.
//     fidelity.activate.ensighten.com -- the domain's entire purpose is
//     serving tracking scripts).
//   - popin.cc: an ad-recommendation-widget vendor's infrastructure domain.
//   - appsflyersdk.com: AppsFlyer's mobile SDK API backend -- distinct from
//     appsflyer.com (the company's own marketing/dashboard site, which was
//     deliberately left off this list since a customer login portal there
//     couldn't be ruled out from rule data alone).
export const CONSOLIDATION_ALLOWLIST = new Set(["en25.com", "ensighten.com", "popin.cc", "appsflyersdk.com"]);

const SIMPLE_BLOCK = /^\|\|([a-z0-9.-]+)\^$/;

function resourceTypesKey(condition) {
  return [...(condition.resourceTypes ?? [])].sort().join(",");
}

/** Same detector as pruneRedundantRules.mjs/consolidation-candidates-
 * reviewed.mjs -- a rule only qualifies if its entire condition is "block
 * this exact domain (+ subdomains) for these resource types", nothing more,
 * so a rule carrying initiatorDomains/domainType/etc. is always left alone. */
function isSimpleDomainBlock(rule) {
  if (rule.action?.type !== "block") return false;
  const condition = rule.condition ?? {};
  const extraKeys = Object.keys(condition).filter((k) => k !== "urlFilter" && k !== "resourceTypes");
  if (extraKeys.length > 0) return false;
  return SIMPLE_BLOCK.test(condition.urlFilter ?? "");
}

function allowlistedAncestor(domain, allowlist) {
  const labels = domain.split(".");
  for (let i = 1; i < labels.length; i++) {
    const ancestor = labels.slice(i).join(".");
    if (allowlist.has(ancestor)) return ancestor;
  }
  return null;
}

/**
 * @param {object[]} rules
 * @param {Set<string>} allowlist defaults to CONSOLIDATION_ALLOWLIST; a
 *   parameter mainly so tests can exercise this against domains that aren't
 *   the real, reviewed list.
 * @returns {{ kept: object[], consolidatedCount: number }} `kept` is `rules`
 *   with every allowlisted domain's sibling subdomain rules collapsed to one
 *   apex `||domain^` rule per distinct resourceTypes set actually present
 *   among its siblings in this array -- reusing the first matching rule's id
 *   and priority rather than minting a new id. Rules for a domain that
 *   isn't a strict subdomain of an allowlisted entry (including the
 *   allowlisted domain's own rules, if any already exist) are never
 *   touched. Only ever called on rules that already went through
 *   pruneRedundantRules -- this doesn't duplicate that check.
 */
export function consolidateSiblingRules(rules, allowlist = CONSOLIDATION_ALLOWLIST) {
  const groups = new Map(); // `${ancestor}|${resourceTypesKey}` -> rule[]
  const matchedIds = new Set();

  for (const rule of rules) {
    if (!isSimpleDomainBlock(rule)) continue;
    const domain = SIMPLE_BLOCK.exec(rule.condition.urlFilter)[1];
    const ancestor = allowlistedAncestor(domain, allowlist);
    if (ancestor === null) continue;
    const key = `${ancestor}|${resourceTypesKey(rule.condition)}`;
    if (!groups.has(key)) groups.set(key, { ancestor, rules: [] });
    groups.get(key).rules.push(rule);
    matchedIds.add(rule.id);
  }

  // Each group's apex rule reuses its first member's id/priority and is
  // spliced in at that member's original position (below), rather than
  // appended at the end -- keeps output order stable/diffable instead of
  // shuffling unrelated rules.
  const idToApexRule = new Map();
  let consolidatedCount = 0;
  for (const { ancestor, rules: groupRules } of groups.values()) {
    const [first, ...rest] = groupRules;
    idToApexRule.set(first.id, { ...first, condition: { ...first.condition, urlFilter: `||${ancestor}^` } });
    consolidatedCount += rest.length;
  }

  const kept = [];
  for (const rule of rules) {
    if (idToApexRule.has(rule.id) && matchedIds.has(rule.id)) {
      kept.push(idToApexRule.get(rule.id));
      continue;
    }
    if (matchedIds.has(rule.id)) continue; // a non-first member of a consolidated group
    kept.push(rule);
  }

  return { kept, consolidatedCount };
}

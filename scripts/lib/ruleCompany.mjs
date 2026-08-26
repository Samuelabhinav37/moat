// Correlates a compiled DNR rule's urlFilter against Ghostery's TrackerDB
// (vendored as @ghostery/trackerdb's dist/trackerdb.json, a flat
// domain -> pattern -> organization lookup) to attribute a blocked request
// to the company behind it. Pulled out of update-filters.mjs (which has
// side effects on import) so it's importable in tests without triggering
// any of that.

// Same suffix-chain semantics as src/shared/domainChain.ts ("does this
// domain, or a parent of it, have an entry") -- duplicated here rather than
// imported because this file runs under plain Node ESM at build time, not
// through the TS/Vite pipeline the runtime copy is bundled by. Kept in sync
// by domainChain.test.mjs asserting both agree on the same sample inputs.
export function domainChain(hostname) {
  const labels = hostname.split(".");
  const chain = [];
  for (let i = 0; i < labels.length - 1; i += 1) {
    chain.push(labels.slice(i).join("."));
  }
  return chain;
}

// AdGuard/uBO urlFilter syntax anchors a domain match with "||", followed by
// the domain and then whatever comes next (^, /, $, *, or nothing). Only
// rules shaped this way have an extractable domain; substring/regex filters
// with no "||" anchor are skipped (return null) rather than guessed at.
const DOMAIN_ANCHOR = /^\|\|([a-z0-9.-]+)/i;

export function extractRuleDomain(urlFilter) {
  if (!urlFilter) return null;
  const match = DOMAIN_ANCHOR.exec(urlFilter);
  if (!match) return null;
  const domain = match[1].toLowerCase();
  // Reject anything that isn't a real domain (no dot) or is a stray "." run.
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;
  return domain;
}

// trackerDb is the parsed dist/trackerdb.json shape: flat maps keyed by
// domain -> patternKey, patternKey -> {organization: orgKey, category, ...},
// and orgKey -> {name, description, website_url, ...}. Walks the domain
// chain most-specific first so a rule targeting a subdomain still resolves
// via its registrable parent.
export function lookupCompanyDetails(domain, trackerDb) {
  for (const level of domainChain(domain)) {
    const patternKey = trackerDb.domains[level];
    if (!patternKey) continue;
    const pattern = trackerDb.patterns[patternKey];
    const org = pattern && trackerDb.organizations[pattern.organization];
    if (org?.name) {
      return {
        name: org.name,
        description: org.description || null,
        websiteUrl: org.website_url || null,
        category: pattern.category || null,
      };
    }
  }
  return null;
}

export function lookupCompany(domain, trackerDb) {
  return lookupCompanyDetails(domain, trackerDb)?.name ?? null;
}

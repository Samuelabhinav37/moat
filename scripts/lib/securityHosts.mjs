// The hosts each bundled danger list (phishing, malware, scams, risky
// downloads) blocks whole pages on, as one small file the service worker
// reads only when a page was stopped (src/background/blockedPage.ts). It
// lets the block page name the danger list without Chrome's rule-match
// lookup, whose quota (20 calls per 10 minutes) ordinary browsing often
// spends first.
//
// Only rules that can stop a page load count: block rules whose
// resourceTypes include main_frame. Whole-site hosts come from
// requestDomains, but only on rules with no URL pattern (some pair "org"
// with a regex that narrows it to a few look-alike sites), and from
// urlFilter patterns that are just a host ("||host^"). A pattern with a
// path ("||mediafire.com/folder/abc/") blocks one page, not the site, so
// it's kept whole under its host and matched against the stopped address
// (src/shared/blockedPage.ts securityGroupFor). Counting its host as a
// whole site named every stopped awin1.com link "phishing", because one
// awin1.com address is on that list. A name without a dot is never a host here.

const HOST_PATTERN = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z0-9]+(?:-[a-z0-9]+)*)(?:\^|\/|$)/i;
/** What may follow the host in a whole-site pattern. */
const WHOLE_SITE_ENDINGS = new Set(["", "^", "^|", "|"]);

/** {group: {hosts, pages}}: sorted unique whole-site hosts, and each
 * host's page-level urlFilter patterns (the part after "||host"), for the
 * manifest's security rulesets. */
export function buildSecurityHosts(manifest, readRuleset) {
  const byGroup = {};
  for (const entry of manifest) {
    if (entry.category !== "security") continue;
    const group = (byGroup[entry.group] ??= { hosts: new Set(), pages: new Map() });
    for (const rule of readRuleset(entry.file)) {
      if (rule.action?.type !== "block") continue;
      const types = rule.condition?.resourceTypes;
      if (!types || !types.includes("main_frame")) continue;
      const { requestDomains = [], urlFilter, regexFilter } = rule.condition;
      if (!urlFilter && !regexFilter) for (const domain of requestDomains) if (domain.includes(".")) group.hosts.add(domain.toLowerCase());
      const match = regexFilter ? null : HOST_PATTERN.exec(urlFilter ?? "");
      if (!match) continue;
      const host = match[1].toLowerCase();
      if (!WHOLE_SITE_ENDINGS.has(urlFilter.slice(2 + host.length))) {
        if (!group.pages.has(host)) group.pages.set(host, new Set());
        // Stored without "||host", which is the key.
        group.pages.get(host).add(urlFilter.slice(2 + host.length));
      } else {
        group.hosts.add(host);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(byGroup).map(([name, { hosts, pages }]) => [
      name,
      {
        hosts: [...hosts].sort(),
        pages: Object.fromEntries([...pages.keys()].sort().map((host) => [host, [...pages.get(host)].sort()])),
      },
    ])
  );
}

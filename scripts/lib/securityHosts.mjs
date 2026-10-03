// The hosts each bundled danger list (phishing, malware, scams, risky
// downloads) blocks whole pages on, as one small file the service worker
// reads only when a page was stopped (src/background/blockedPage.ts). It
// lets the block page name the danger list without Chrome's rule-match
// lookup, whose quota (20 calls per 10 minutes) ordinary browsing often
// spends first.
//
// Only rules that can stop a page load count: block rules whose
// resourceTypes include main_frame. Hosts come from requestDomains, but only
// on rules with no URL pattern (some pair "org" with a regex that narrows it
// to a few look-alike sites), and from urlFilter patterns anchored to a host
// ("||host^", "||host/path"). A name without a dot is never a host here.

const HOST_PATTERN = /^\|\|([a-z0-9][a-z0-9.-]*\.[a-z0-9]+(?:-[a-z0-9]+)*)(?:\^|\/|$)/i;

/** {group: sorted unique hosts} for the manifest's security rulesets. */
export function buildSecurityHosts(manifest, readRuleset) {
  const byGroup = {};
  for (const entry of manifest) {
    if (entry.category !== "security") continue;
    const hosts = (byGroup[entry.group] ??= new Set());
    for (const rule of readRuleset(entry.file)) {
      if (rule.action?.type !== "block") continue;
      const types = rule.condition?.resourceTypes;
      if (!types || !types.includes("main_frame")) continue;
      const { requestDomains = [], urlFilter, regexFilter } = rule.condition;
      if (!urlFilter && !regexFilter) for (const domain of requestDomains) if (domain.includes(".")) hosts.add(domain.toLowerCase());
      const match = HOST_PATTERN.exec(urlFilter ?? "");
      if (match && !regexFilter) hosts.add(match[1].toLowerCase());
    }
  }
  return Object.fromEntries(Object.entries(byGroup).map(([group, hosts]) => [group, [...hosts].sort()]));
}

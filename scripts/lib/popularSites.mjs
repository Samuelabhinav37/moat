// The Tranco top 10,000 sites, for keeping the danger lists (phishing,
// malware, scams) from blocking a popular site as a whole. Used when the
// lists are built and published, never shipped: a popular site can't be
// taken down by one bad upstream entry, whatever the list says.
//
// Only whole-site entries are dropped: the site itself or its "www.". A
// phishing page on a subdomain of a popular host (x.weebly.com,
// bucket.oss-ap-southeast-1.aliyuncs.com) stays blocked, and on 2026-10-07
// there were 4,417 of those in the phishing list alone. The same day no
// whole-site entry in any of the three live lists was a top-10k site.
import { fetchWithRetry } from "./fetchWithRetry.mjs";
import { registrableDomain } from "./publicSuffixList.mjs";

const TRANCO_ID_URL = "https://tranco-list.eu/top-1m-id";
export const POPULAR_SITE_COUNT = 10_000;

/** "rank,domain" lines to a set of the domains and their registrable
 * domains. A Tranco entry can itself be a subdomain (a site's own CDN or
 * sign-in host), so both forms count. */
export function parsePopularSites(csv, psl) {
  const sites = new Set();
  for (const line of csv.split(/\r?\n/)) {
    const domain = line.split(",")[1]?.trim().toLowerCase();
    if (!domain) continue;
    sites.add(domain);
    const registrable = registrableDomain(domain, psl);
    if (registrable) sites.add(registrable);
  }
  return sites;
}

export async function loadPopularSites(psl, count = POPULAR_SITE_COUNT) {
  const id = (await (await fetchWithRetry(TRANCO_ID_URL)).text()).trim();
  if (!/^[A-Z0-9]+$/i.test(id)) throw new Error(`Unexpected Tranco list id: ${JSON.stringify(id.slice(0, 40))}`);
  const response = await fetchWithRetry(`https://tranco-list.eu/download/${id}/${count}`);
  if (!response.ok) throw new Error(`Failed to fetch the Tranco list ${id}: ${response.status} ${response.statusText}`);
  const sites = parsePopularSites(await response.text(), psl);
  // A short or empty download would quietly turn the guard off.
  if (sites.size < count * 0.9) throw new Error(`Tranco list ${id} parsed to only ${sites.size} sites, expected about ${count}`);
  return sites;
}

/** True when blocking this host would block a popular site as a whole:
 * the host is the site, or its "www.", or a host Tranco ranks itself. */
export function isWholePopularSite(host, popular) {
  return popular.has(host.toLowerCase().replace(/^www\./, ""));
}

/** Splits a danger list into the domains to keep and the popular ones to
 * drop. */
export function dropPopularSites(domains, popular) {
  const kept = [];
  const dropped = [];
  for (const domain of domains) (isWholePopularSite(domain, popular) ? dropped : kept).push(domain);
  return { kept, dropped };
}

const HOST_FILTER = /^\|\|([a-z0-9.-]+)\^$/i;

/** The same check for a bundled danger ruleset's DNR block rules: drops a
 * "||host^" rule for a popular site, and takes popular sites out of a
 * rule's requestDomains (dropping the rule if none are left). Rules with
 * a path or a regex are kept: they block one page, not the site. */
export function dropPopularSiteRules(rules, popular) {
  const kept = [];
  const dropped = [];
  for (const rule of rules) {
    if (rule.action?.type !== "block") {
      kept.push(rule);
      continue;
    }
    const condition = rule.condition ?? {};
    const host = condition.regexFilter ? null : HOST_FILTER.exec(condition.urlFilter ?? "")?.[1];
    if (host && isWholePopularSite(host, popular)) {
      dropped.push(host.toLowerCase());
      continue;
    }
    if (Array.isArray(condition.requestDomains) && !condition.urlFilter && !condition.regexFilter) {
      const domains = condition.requestDomains.filter((domain) => !isWholePopularSite(domain, popular));
      if (domains.length < condition.requestDomains.length) {
        dropped.push(...condition.requestDomains.filter((domain) => !domains.includes(domain)).map((d) => d.toLowerCase()));
        if (domains.length === 0) continue;
        kept.push({ ...rule, condition: { ...condition, requestDomains: domains } });
        continue;
      }
    }
    kept.push(rule);
  }
  return { kept, dropped };
}

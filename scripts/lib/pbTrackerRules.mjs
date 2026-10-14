// Trackers Privacy Badger's crawler (Badger Sett) saw following people
// across sites, that Moat's own lists don't already block. Privacy Badger
// (EFF, GPL-3.0) blocks these for every user by default. Measured
// 2026-10-14: Moat's lists missed 1,875 of its 3,098.
//
// Blocked as Privacy Badger blocks them: only as a third party, never a page
// you open yourself (no main_frame), and never on another site of the same
// company. Left out, because Privacy Badger doesn't block them outright
// either, or Moat keeps them working:
//   - yellowlisted domains (pbconfig.json): sites need them, so they lose
//     their cookies instead (trackerCookieRules.mjs). A yellowlisted host
//     under a blocked domain is excluded from the block.
//   - embeds Privacy Badger swaps for a click-to-load button
//     (socialwidgets.json): Moat has no button yet, and blocking them leaves
//     a hole in the page. The social-widgets list covers them for those who
//     want it.
//   - site fixes (pbconfig.json sitefixes): a domain left alone on the sites
//     where blocking it is known to break the page.
//   - sign-in, payment, fraud-check and bot-check hosts (KEEP_COOKIES_HOSTS).
//   - Facebook's login SDK (connect.facebook.net/<locale>/sdk.js): Privacy
//     Badger blocks facebook.net whole, which breaks "Continue with
//     Facebook" buttons. An allow rule a step above keeps the SDK; the Meta
//     Pixel (fbevents.js) on the same host stays blocked.
import { KEEP_COOKIES_HOSTS } from "./trackerCookieRules.mjs";
import { entityLookup } from "./privacyBadgerData.mjs";
import { isBlockedByDomainChain } from "./blockedDomains.mjs";
import { registrableDomain } from "./publicSuffixList.mjs";

export const PB_TRACKER_PRIORITY = 1;

/** Paths on blocked hosts that sign-in buttons load. Allowed one step above
 * the blocks, so only this ruleset's blocks give way. */
export const SIGN_IN_ALLOWS = [{ urlFilter: "||connect.facebook.net/*/sdk.js", resourceTypes: ["script"] }];

// Every type but main_frame.
const RESOURCE_TYPES = [
  "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
];

const LOOPBACK = /(^|\.)localhost$|^127\.|^\[?::1\]?$/;

/** `host` is in `set`, or under a domain that is. */
const coveredBy = (host, set) => isBlockedByDomainChain(host, set);

/** Hosts in `list` strictly under `domain`. */
function under(domain, list) {
  return list.filter((host) => host.endsWith(`.${domain}`));
}

/**
 * @param {object} data Privacy Badger data (privacyBadgerData.mjs).
 * @param {object} opts
 * @param {Set<string>} opts.alreadyBlocked domains Moat's own lists block outright (with subdomains).
 * @param {object} opts.psl from loadPsl().
 * @param {(domain: string) => string | null} [opts.companyOf] TrackerDB company, for the dashboard.
 * @param {number} [opts.firstId]
 * @returns {{ rules: object[], domains: string[], companies: Map<number, string>, skipped: Record<string, string[]> }}
 *   Domains are packed into one rule per set of excluded sites: Firefox's default preset has to
 *   fit 30,000 rules. `companies` maps a rule id to its company when all its domains share one
 *   (the popup's by-company count; the dashboard names companies from the address itself,
 *   src/shared/trackerDomains.ts).
 */
export function buildPbTrackerRules(data, { alreadyBlocked, psl, companyOf = () => null, firstId = 1 }) {
  const { block, yellowlist, widgetDomains, siteFixes, entities } = data;
  const yellow = new Set(yellowlist);
  const widgets = new Set(widgetDomains);
  const keep = new Set(KEEP_COOKIES_HOSTS);
  const owners = entityLookup(entities);
  const skipped = { alreadyBlocked: [], yellowlisted: [], widget: [], keep: [], loopback: [] };
  const domains = [];
  const packs = new Map();
  for (const domain of block) {
    if (LOOPBACK.test(domain)) skipped.loopback.push(domain);
    else if (coveredBy(domain, alreadyBlocked)) skipped.alreadyBlocked.push(domain);
    else if (coveredBy(domain, yellow)) skipped.yellowlisted.push(domain);
    else if (coveredBy(domain, widgets)) skipped.widget.push(domain);
    else if (coveredBy(domain, keep)) skipped.keep.push(domain);
    else {
      const site = registrableDomain(domain, psl) ?? domain;
      const fixSites = Object.entries(siteFixes)
        .filter(([fixed]) => fixed === domain || fixed.endsWith(`.${domain}`) || domain.endsWith(`.${fixed}`))
        .flatMap(([, sites]) => sites);
      const excludedInitiators = [...new Set([...(owners.get(site) ?? []), ...fixSites])].sort();
      // Excluded hosts sit under their own domain, so they can share a rule.
      const excludedRequests = [...under(domain, yellowlist), ...under(domain, widgetDomains), ...under(domain, KEEP_COOKIES_HOSTS)];
      const key = excludedInitiators.join(",");
      if (!packs.has(key)) packs.set(key, { companies: new Set(), excludedInitiators, requestDomains: [], excludedRequests: new Set() });
      const pack = packs.get(key);
      pack.requestDomains.push(domain);
      pack.companies.add(companyOf(domain));
      for (const host of excludedRequests) pack.excludedRequests.add(host);
      domains.push(domain);
    }
  }
  const rules = [];
  const companies = new Map();
  for (const [, pack] of [...packs].sort(([a], [b]) => a.localeCompare(b))) {
    const condition = { requestDomains: pack.requestDomains.sort(), domainType: "thirdParty", resourceTypes: RESOURCE_TYPES };
    if (pack.excludedInitiators.length) condition.excludedInitiatorDomains = pack.excludedInitiators;
    if (pack.excludedRequests.size) condition.excludedRequestDomains = [...pack.excludedRequests].sort();
    const id = firstId + rules.length;
    rules.push({ id, priority: PB_TRACKER_PRIORITY, action: { type: "block" }, condition });
    const [only] = pack.companies;
    if (pack.companies.size === 1 && only) companies.set(id, only);
  }
  for (const condition of SIGN_IN_ALLOWS) {
    if (!domains.some((domain) => condition.urlFilter.startsWith(`||${domain}`) || condition.urlFilter.includes(`.${domain}/`))) continue;
    rules.push({ id: firstId + rules.length, priority: PB_TRACKER_PRIORITY + 1, action: { type: "allow" }, condition: { ...condition } });
  }
  return { rules, domains, companies, skipped };
}

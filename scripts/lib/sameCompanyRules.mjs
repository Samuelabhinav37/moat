// DuckDuckGo's same-company rule: a tracker isn't blocked on a site owned by
// the company that runs it (Google Analytics on youtube.com, Bing's tag on
// msn.com). The company already sees that visit, so blocking it protects
// nothing and is what breaks sign-ins and video players.
//
// One allow rule per company, from Privacy Badger's company groups
// (privacyBadgerData.mjs entities): the tracker hosts Moat's tracker lists
// block outright, allowed only when a page of that company's own sites asks.
// Left blocked:
//   - hosts the ad lists or oisd name in any rule, and hosts named like ad
//     servers (ads., adservice, advertising): an ad stays an ad;
//   - rules for one path on a host (EasyPrivacy's "||youtube.com/api/stats/"),
//     which are aimed at the first-party case on purpose;
//   - the page itself (no main_frame), and anything the security lists or a
//     quick fix block, which sit above this priority.
import { isBlockedByDomainChain } from "./blockedDomains.mjs";
import { entityLookup } from "./privacyBadgerData.mjs";
import { registrableDomain } from "./publicSuffixList.mjs";
import { QUICK_FIX_PRIORITY } from "../../src/shared/rulePriorities.ts";

/** Above every bundled list rule, below the live quick fixes. */
export const SAME_COMPANY_PRIORITY = QUICK_FIX_PRIORITY - 1;

const AD_HOST = /(^|[.-])ads?d*([.-]|$)|adservice|advertising|adserver|doubleclick/;

const RESOURCE_TYPES = [
  "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
];

/**
 * @param {Iterable<string>} trackerDomains hosts the tracker lists block outright.
 * @param {Set<string>} adDomains hosts the ad lists and oisd name in a rule.
 * @param {string[][]} entities Privacy Badger's company site groups.
 * @param {object} psl from loadPsl().
 * @returns {object[]} allow rules, ids from 1.
 */
export function buildSameCompanyRules(trackerDomains, adDomains, entities, psl) {
  const owners = entityLookup(entities);
  const byCompany = new Map();
  for (const domain of trackerDomains) {
    if (AD_HOST.test(domain) || isBlockedByDomainChain(domain, adDomains)) continue;
    const sites = owners.get(registrableDomain(domain, psl) ?? domain);
    if (!sites) continue;
    if (!byCompany.has(sites)) byCompany.set(sites, new Set());
    byCompany.get(sites).add(domain);
  }
  return [...byCompany]
    .map(([sites, hosts]) => ({ sites: [...sites].sort(), hosts: [...hosts].sort() }))
    .sort((a, b) => a.sites[0].localeCompare(b.sites[0]))
    .map(({ sites, hosts }, i) => ({
      id: i + 1,
      priority: SAME_COMPANY_PRIORITY,
      action: { type: "allow" },
      condition: { requestDomains: hosts, initiatorDomains: sites, resourceTypes: RESOURCE_TYPES },
    }));
}

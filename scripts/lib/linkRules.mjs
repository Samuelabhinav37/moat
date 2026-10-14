// Links people click, especially in email, reach where they lead (field report
// 2026-10-14: click.discord.com, awstrack.me, t.co and other email
// click-trackers opened on Moat's block page). Peter Lowe's list and oisd,
// where those came from, no longer block pages (peterLoweRules.mjs,
// oisdRules.mjs). AdGuard's lists keep their page blocks: they're its
// pop-up, malvertising and IP-logger rules, not email links. Two parts here,
// both used by update-filters.mjs:
//
//   - withoutSharedLinkBlocks: a security list never blocks, as a whole site,
//     a link host every customer of an email or link service shares
//     (src/shared/sharedLinkHosts.ts). It still blocks one sender's own
//     subdomain, and any page-level pattern on a shared host. The bad
//     destination is blocked when it loads.
//   - buildLinkSkipRules: a wrapped link whose destination is written plainly
//     in it (Google's /url?q=https://...) goes straight there, so the
//     wrapper never learns of the click. Privacy Badger does the same
//     (its data/dnr/bypass_redirects.json, mv3-chrome branch); one regex
//     per pattern here instead of one rule per Google domain. The
//     destination is only taken when it has no "&" or "%": an encoded one
//     loads the wrapper as normal, which takes you there itself. Plus
//     Privacy Badger's block on Google's gen_204 click pings
//     (data/dnr/gen204.json).
import { isSharedLinkHost } from "../../src/shared/sharedLinkHosts.ts";

/** Below a paused site and "Open anyway" (src/shared/rulePriorities.ts), above
 * the lists' own priority-1 rules, as Privacy Badger's are. */
export const LINK_SKIP_PRIORITY = 2;

const WHOLE_HOST = /^\|\|([a-z0-9.-]+)(?:\^|\^\||\|)?$/i;

/** A security rule without whole-site blocks of shared link hosts. Null when
 * that was all it blocked. */
export function withoutSharedLinkBlocks(rule) {
  if (rule.action?.type !== "block") return rule;
  const { urlFilter, regexFilter, requestDomains } = rule.condition ?? {};
  if (urlFilter) {
    const host = WHOLE_HOST.exec(urlFilter)?.[1];
    return host && isSharedLinkHost(host) ? null : rule;
  }
  if (regexFilter || !requestDomains) return rule;
  const kept = requestDomains.filter((domain) => !isSharedLinkHost(domain));
  if (kept.length === requestDomains.length) return rule;
  return kept.length ? { ...rule, condition: { ...rule.condition, requestDomains: kept } } : null;
}

// Hosts in a skip pattern: Google's own domains, written as a regex part.
const GOOGLE = String.raw`www\.google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})`;
// The destination, plain: no "&" (the next parameter) and no "%" (encoded).
const PLAIN = String.raw`(https?://[^&%]+)`;

/** Wrapped-link patterns: [regexFilter, why]. Each captures the destination
 * as \1 and must match the whole address. */
export const LINK_SKIPS = [
  [String.raw`^https://${GOOGLE}/url\?(?:[^#]*&)?(?:q|url)=${PLAIN}(?:&.*|$)`, "Google's /url links (search, Gmail, Docs)"],
  [String.raw`^https://(?:www\.)?googleadservices\.com/pagead/aclk\?(?:[^#]*&)?adurl=${PLAIN}(?:&.*|$)`, "Google ad clicks"],
  [String.raw`^https://click\.linksynergy\.com/deeplink\?(?:[^#]*&)?murl=${PLAIN}(?:&.*|$)`, "Rakuten affiliate links"],
  [String.raw`^https://www\.awin1\.com/cread\.php\?(?:[^#]*&)?ued=${PLAIN}(?:&.*|$)`, "Awin affiliate links"],
];

/** Pages Google pings when a result is clicked. urlFilter's "*" stands for
 * any Google domain. */
const GEN_204 = "|https://www.google.*/gen_204^";

export function buildLinkSkipRules(firstId = 1) {
  const skips = LINK_SKIPS.map(([regexFilter], i) => ({
    id: firstId + i,
    priority: LINK_SKIP_PRIORITY,
    action: { type: "redirect", redirect: { regexSubstitution: "\\1" } },
    condition: { regexFilter, resourceTypes: ["main_frame"] },
  }));
  return [
    ...skips,
    { id: firstId + skips.length, priority: 1, action: { type: "block" }, condition: { urlFilter: GEN_204, resourceTypes: ["ping"] } },
  ];
}

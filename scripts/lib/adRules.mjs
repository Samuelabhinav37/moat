// Which rules outside the ads lists stop an ad server, so the popup and
// Overview count those blocks as ads. The popup buckets a block by the list
// whose rule won the match (src/shared/matchedRuleCategories.ts), and the
// tracking lists also stop ad servers: on a page with AdSense, Google's ad
// tag and Taboola, Chrome matched Google's ad tag and Taboola with
// trackers-* rules, so the popup said "0 ads, 6 trackers".
//
// A rule is classed by the host it targets. Rules that list many hosts
// (packed by scripts/pack-rules.mjs) can't be, so they keep their list's
// bucket.

import { isBlockedByDomainChain } from "./blockedDomains.mjs";

// "||host^" or "||host/path…": the host a urlFilter is anchored to.
const HOST_ANCHOR = /^\|\|([a-z0-9.-]+)[\^/]/i;

/** The one host a counted rule (a block, or a redirect to a stub, which the
 * popup also counts) stops, or null. Other conditions (resource types,
 * first/third party, which sites it applies on) narrow where it applies,
 * not what it stops, so they don't matter here. */
export function targetHost(rule) {
  const counted = rule.action?.type === "block" || Boolean(rule.action?.redirect?.extensionPath);
  if (!counted) return null;
  const condition = rule.condition ?? {};
  if (condition.regexFilter !== undefined) return null;
  if (condition.urlFilter !== undefined) {
    const match = HOST_ANCHOR.exec(condition.urlFilter);
    return match ? match[1].toLowerCase() : null;
  }
  if (condition.requestDomains?.length === 1) return condition.requestDomains[0].toLowerCase();
  return null;
}

/** The lists whose rules can be counted as ads instead: the tracking
 * lists. A pop-up from an ad network still counts as a pop-up, and a
 * dangerous site as what it is. */
export const REBUCKETED_GROUPS = new Set(["trackers", "url-tracking"]);

/**
 * @param {{ id: string, group: string, file: string }[]} manifestEntries
 * @param {(file: string) => any[]} readRules
 * @param {Set<string>} adDomains ad servers: what the ads lists block, plus rules/ad-networks.json
 * @returns {Record<string, number[]>} rulesetId -> ids of rules that stop an ad server
 */
export function computeAdRules(manifestEntries, readRules, adDomains) {
  const result = {};
  for (const entry of manifestEntries) {
    if (!REBUCKETED_GROUPS.has(entry.group)) continue;
    const ids = [];
    for (const rule of readRules(entry.file)) {
      const host = targetHost(rule);
      if (host && isBlockedByDomainChain(host, adDomains)) ids.push(rule.id);
    }
    if (ids.length) result[entry.id] = ids;
  }
  return result;
}

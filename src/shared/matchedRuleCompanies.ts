import type { MatchedRuleRef } from "./matchedRuleCategories";

/** rulesetId (e.g. "ruleset_ads-2", matching MatchedRuleRef.rulesetId) ->
 * ruleId -> company name. Built at filter-update time by correlating each
 * rule's urlFilter domain against Ghostery's TrackerDB -- see
 * scripts/update-filters.mjs and scripts/lib/ruleCompany.mjs. Most rules
 * have no entry (TrackerDB only covers ~5k of the ~274k bundled domains);
 * this is a purely additive detail on top of the existing Ads/Trackers/
 * Popups breakdown, not a replacement for it. */
export type RuleCompanies = Record<string, Record<number, string>>;

export function summarizeCompanies(companies: RuleCompanies, matches: MatchedRuleRef[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of matches) {
    if (match.ruleId === undefined) continue;
    const company = companies[match.rulesetId]?.[match.ruleId];
    if (!company) continue;
    counts[company] = (counts[company] ?? 0) + 1;
  }
  return counts;
}

import type { MatchedRuleRef } from "./matchedRuleCategories";

/** rulesetId (e.g. "ruleset_ads-2", matching MatchedRuleRef.rulesetId) ->
 * ruleId -> company name. Built at filter-update time by correlating each
 * rule's urlFilter domain against Ghostery's TrackerDB -- see
 * scripts/update-filters.mjs and scripts/lib/ruleCompany.mjs. Most rules
 * have no entry (TrackerDB only covers ~5k of the ~274k bundled domains);
 * this is a purely additive detail on top of the existing Ads/Trackers/
 * Popups breakdown, not a replacement for it. */
export type RuleCompanies = Record<string, Record<number, string>>;

/** Company name -> a short description/category/link, for the popup's
 * click-through company drill-down. Built at filter-update time alongside
 * RuleCompanies above (see scripts/update-filters.mjs), deduped to one entry
 * per company actually attributed to a shipped rule rather than shipping
 * TrackerDB's full organization catalog. Any field can be null -- TrackerDB
 * doesn't have complete data for every organization. */
export type CompanyInfo = Record<string, { description: string | null; websiteUrl: string | null; category: string | null }>;

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

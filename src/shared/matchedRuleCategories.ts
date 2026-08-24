import type { RulesetManifestEntry } from "./rulesetManifest";

type BreakdownBucket = "ads" | "trackers" | "popups";

// Collapses the 11 bundled filter-list groups (see scripts/update-filters.mjs)
// into the three buckets shown in the popup: "ads" is the literal AdGuard
// Base filter, "popups" is the AdGuard Popups filter (the caller adds the
// popup/redirect firewall's own real-time catches on top of this), and
// everything else -- tracking/URL-tracking, malicious/phishing/scam/badware
// domains, cookie notices, social widgets, other annoyances -- folds into
// "trackers" as a catch-all "stuff quietly working against you" bucket. Too
// coarse to audit with, but this is a three-tile popup summary, not a report;
// the Filter Lists tab already shows the real per-list breakdown.
const GROUP_TO_BUCKET: Partial<Record<string, BreakdownBucket>> = {
  ads: "ads",
  popups: "popups",
  trackers: "trackers",
  "url-tracking": "trackers",
  "social-widgets": "trackers",
  "cookie-notices": "trackers",
  annoyances: "trackers",
  "malicious-urls": "trackers",
  "phishing-urls": "trackers",
  scam: "trackers",
  badware: "trackers",
};

export interface MatchedRuleRef {
  rulesetId: string;
  /** Optional so existing rulesetId-only callers/tests keep working --
   * only matchedRuleCompanies.ts's summarizeCompanies needs this. */
  ruleId?: number;
}

export type Breakdown = Record<BreakdownBucket, number>;

export function summarizeMatchedRules(
  manifest: RulesetManifestEntry[],
  matches: MatchedRuleRef[]
): Breakdown {
  const idToGroup = new Map(manifest.map((entry) => [entry.id, entry.group]));
  const counts: Breakdown = { ads: 0, trackers: 0, popups: 0 };
  for (const match of matches) {
    const group = idToGroup.get(match.rulesetId);
    const bucket = group ? GROUP_TO_BUCKET[group] : undefined;
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

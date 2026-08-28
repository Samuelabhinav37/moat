// Identifies which bundled filter-list groups are "security" lists (known
// malicious/phishing/scam/badware domains) as opposed to ordinary ads/
// trackers/annoyances -- a distinction matchedRuleCategories.ts deliberately
// doesn't make (it folds all four into "trackers" for the popup's three-tile
// summary). Only used by athenaIntegration.ts to decide whether a matched
// rule is worth a minimized security event; has no effect on blocking itself
// and nothing here is new blocking logic, just classification of an already-
// blocked request.
import type { RulesetManifestEntry } from "./rulesetManifest";
import type { AthenaSecurityEvent } from "../types";

type RiskTier = AthenaSecurityEvent["riskTier"];

// phishing-urls/malicious-urls/scam are Moat's three largest, most
// confident-to-act-on security lists (see README's "How it works" --
// distinct from the general Base/Tracking Protection ad-and-tracker lists).
// badware is real but narrower in scope (flags software-bundling risk more
// than an active attack), hence "medium" rather than "high" here.
const HIGH_RISK_GROUPS = new Set(["malicious-urls", "phishing-urls", "scam"]);
const MEDIUM_RISK_GROUPS = new Set(["badware"]);

export function riskTierForGroup(group: string): RiskTier | null {
  if (HIGH_RISK_GROUPS.has(group)) return "high";
  if (MEDIUM_RISK_GROUPS.has(group)) return "medium";
  return null;
}

export function isSecurityGroup(group: string): boolean {
  return riskTierForGroup(group) !== null;
}

/** Given the same {rulesetId, ruleId} matches refreshBreakdown already
 * computes, returns just the ones worth a security event -- everything
 * else (ads, ordinary trackers, cookie notices, ...) is intentionally not
 * classified into a risk tier at all, matching riskTierForGroup above. */
export function securityMatches(
  manifest: RulesetManifestEntry[],
  matches: { rulesetId: string; ruleId?: number }[]
): { rulesetId: string; ruleId?: number; riskTier: RiskTier }[] {
  const idToGroup = new Map(manifest.map((entry) => [entry.id, entry.group]));
  const result: { rulesetId: string; ruleId?: number; riskTier: RiskTier }[] = [];
  for (const match of matches) {
    const group = idToGroup.get(match.rulesetId);
    const riskTier = group ? riskTierForGroup(group) : null;
    if (riskTier) result.push({ rulesetId: match.rulesetId, ruleId: match.ruleId, riskTier });
  }
  return result;
}

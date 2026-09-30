// Pure logic pulled out of filterGroups.ts (which imports
// webextension-polyfill and throws on import outside a real extension
// context) so it's testable without a browser environment.
import type { Settings } from "../types";

/** Master switch off -> every toggleable list off; otherwise each list's own override, defaulting to on. */
export function effectiveFilterGroupState(
  masterEnabled: boolean,
  filterGroups: Settings["filterGroups"],
  groups: string[]
): Record<string, boolean> {
  return Object.fromEntries(groups.map((group) => [group, masterEnabled && (filterGroups[group] ?? true)]));
}

export interface FilterListInfo {
  group: string;
  category: string;
  ruleCount: number;
}

/** Which lists matter most when the browser can't hold every list the
 * user turned on (Firefox allows 30,000 static rules per extension; Moat's
 * default lists need about 68,000). Most important first:
 *  - Ads first: it's an ad blocker.
 *  - Scam and badware: small, and no daily list covers them.
 *  - Trackers, pop-ups, link tracking, oisd.
 *  - The bundled malware and phishing lists next. Their domains are also
 *    delivered by the daily security lists as dynamic rules, which don't use
 *    this budget (liveSecurityRules.ts keeps those on for any list the user
 *    turned on, even when its bundled ruleset doesn't fit).
 *  - Annoyance lists last.
 * Groups not named here follow, security before ads before annoyance. */
const IMPORTANCE = [
  "privacy-headers",
  "ads",
  "scam",
  "badware",
  "trackers",
  "popups",
  "url-tracking",
  "oisd",
  "malicious-urls",
  "phishing-urls",
  "cookie-notices",
  "annoyances",
  "social-widgets",
];
const CATEGORY_RANK: Record<string, number> = { security: 0, ads: 1, annoyance: 2 };

/** The groups a user wants on, most important first. Only reorders. */
export function orderGroupsByImportance(wantOn: FilterListInfo[]): string[] {
  const rank = (list: FilterListInfo): number => {
    const i = IMPORTANCE.indexOf(list.group);
    return i !== -1 ? i : IMPORTANCE.length + (CATEGORY_RANK[list.category] ?? 1);
  };
  return [...wantOn].sort((a, b) => rank(a) - rank(b)).map((list) => list.group);
}

/** What fits in `limit` rules: take the lists most important first and skip
 * any that doesn't fit, so one big list can't push out several smaller
 * ones. The same choice filterGroups.ts makes against the real browser;
 * scripts/validate-rules.mjs uses this to check the Firefox default. */
export function fillByImportance(wantOn: FilterListInfo[], limit: number): { kept: string[]; dropped: string[] } {
  const byGroup = new Map(wantOn.map((list) => [list.group, list]));
  const kept: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const group of orderGroupsByImportance(wantOn)) {
    const rules = byGroup.get(group)!.ruleCount;
    if (used + rules <= limit) {
      kept.push(group);
      used += rules;
    } else {
      dropped.push(group);
    }
  }
  return { kept, dropped };
}

/** How many static rules a set of filter-group choices really turns on,
 * counting every ruleset in the manifest -- including a group the choices
 * don't mention, which effectiveFilterGroupState treats as on. That gap is
 * how oisd ended up on in every preset, uncounted, until 0.11.130.
 * scripts/validate-rules.mjs uses this to fail the build when the
 * fresh-install preset no longer fits Chrome's static-rule limit. */
export function enabledRuleCount(
  entries: ReadonlyArray<{ group: string; ruleCount: number }>,
  filterGroups: Settings["filterGroups"]
): number {
  const state = effectiveFilterGroupState(
    true,
    filterGroups,
    entries.map((entry) => entry.group)
  );
  return entries.filter((entry) => state[entry.group]).reduce((sum, entry) => sum + entry.ruleCount, 0);
}

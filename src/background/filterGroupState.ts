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

// Lower number = kept longest when the shared static-rule budget can't hold
// everything the user wants enabled. Annoyance/cosmetic lists are the least
// essential (missing them means an occasional un-hidden cookie banner);
// security (known-malicious/phishing domains) is the last thing worth
// losing. Any category not listed here (shouldn't happen -- "core" isn't
// user-toggleable) sorts with "ads".
const CATEGORY_DROP_PRIORITY: Record<string, number> = { annoyance: 0, ads: 1, security: 2 };

/** Orders the groups a user wants enabled by how expendable they are if
 * `declarativeNetRequest.updateEnabledRulesets` can't fit all of them at
 * once -- see filterGroups.ts's retry loop, which drops from the front of
 * this list one group at a time until something fits. Within the same
 * priority tier, the biggest rule count is ordered first, since dropping it
 * frees the most budget per retry. Only reorders; never adds or removes a
 * group from `wantOn`. */
export function orderGroupsByDropPriority(wantOn: FilterListInfo[]): string[] {
  return [...wantOn]
    .sort((a, b) => {
      const priorityDiff = (CATEGORY_DROP_PRIORITY[a.category] ?? 1) - (CATEGORY_DROP_PRIORITY[b.category] ?? 1);
      return priorityDiff !== 0 ? priorityDiff : b.ruleCount - a.ruleCount;
    })
    .map((list) => list.group);
}

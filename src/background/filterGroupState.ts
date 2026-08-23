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

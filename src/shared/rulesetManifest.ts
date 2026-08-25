// Shape of rules/dnr/manifest.json, copied into dist/<target>/rules/manifest.json
// at build time (see scripts/build.mjs) and fetched at runtime by both the
// background worker (to apply filter-group toggles) and the options page
// (to render the Filter Lists tab). Kept free of any webextension-polyfill
// import (unlike rulesetManifestLoader.ts, which fetches the actual file)
// so this stays testable without a browser extension context.
export interface RulesetManifestEntry {
  id: string;
  group: string;
  category: "ads" | "security" | "annoyance" | "core";
  name: string;
  enabled: boolean;
  file: string;
  ruleCount: number;
}

/** Every static ruleset id belonging to a given group (chunked lists share one group, e.g. "ads-1"/"ads-2" -> "ads"). */
export function groupChunkIds(manifest: RulesetManifestEntry[], group: string): string[] {
  return manifest.filter((entry) => entry.group === group).map((entry) => entry.id);
}

/** One row per logical list for the settings UI: name with any "(1/2)" chunk suffix stripped, plus its category. */
interface FilterListSummary {
  group: string;
  category: RulesetManifestEntry["category"];
  name: string;
  ruleCount: number;
}

export function summarizeFilterLists(manifest: RulesetManifestEntry[]): FilterListSummary[] {
  const byGroup = new Map<string, FilterListSummary>();
  for (const entry of manifest) {
    if (entry.category === "core") continue; // not user-toggleable, see update-filters.mjs
    const existing = byGroup.get(entry.group);
    if (existing) {
      existing.ruleCount += entry.ruleCount;
    } else {
      byGroup.set(entry.group, {
        group: entry.group,
        category: entry.category,
        name: entry.name.replace(/\s*\(\d+\/\d+\)$/, ""),
        ruleCount: entry.ruleCount,
      });
    }
  }
  return [...byGroup.values()];
}

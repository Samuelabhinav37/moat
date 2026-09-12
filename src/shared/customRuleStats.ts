// Pure key-building + staleness logic for background/customRuleStats.ts,
// same "browser-free, testable" split as usageStatsState.ts.
export type CustomRuleKind = "hide" | "gray";

/** hostname/selector come straight from the user's own saved element-picker
 * rules (settings.customCosmeticRules/customGrayscaleRules) -- neither ever
 * contains a literal ":" in normal use (selectors are validated by
 * shared/selectorSafety.ts before they're ever saved), so a plain join is
 * unambiguous enough for an internal storage key. */
export function customRuleStatKey(kind: CustomRuleKind, hostname: string, selector: string): string {
  return `${kind}:${hostname}:${selector}`;
}

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** A rule that has never matched and was created over 30 days ago is just
 * as legitimately stale as one that used to match and stopped -- both read
 * the same "the site probably changed" signal, so lastMatchedAt falls back
 * to createdAt rather than treating "never matched yet" as automatically
 * fresh. */
export function isStale(stat: { lastMatchedAt: number | null; createdAt: number }, when: number): boolean {
  return when - (stat.lastMatchedAt ?? stat.createdAt) > STALE_AFTER_MS;
}

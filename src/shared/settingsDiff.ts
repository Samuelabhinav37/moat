// Pure summary of what a validated settings-import patch would actually
// change against the currently-stored settings -- backs the Backup tab's
// restore-preview step. Kept free of any webextension-polyfill import, same
// convention as settingsPortability.ts, so it's callable directly from
// options.ts before anything is sent to the background for real (a read,
// not a write -- see options.ts's own comment on why direct reads from a
// background module are fine while writes still go through a message).
//
// Deliberately a coarse, category-level summary (counts, not a field-by-
// field diff) -- the Backup tab's own "What a backup contains" manifest
// already uses this same four-category framing (protection settings,
// custom rules, site exceptions, filter list choices), so the preview
// speaks the same language as the rest of the tab instead of introducing a
// new vocabulary just for this.
import type { Settings } from "../types";

export interface SettingsImportSummary {
  protectionSettingsChanged: number;
  customRulesChanged: boolean;
  siteExceptionsChanged: boolean;
  filterListChoicesChanged: boolean;
  syncSettingChanged: boolean;
  /** True if the patch would change nothing at all -- current settings
   * already match the file being imported. */
  isNoOp: boolean;
}

// Same bucketing as the Backup tab's own manifest count (renderBackupTab):
// customAllowedDomains is "the opposite of a rule" (see its own doc comment
// in types.ts) and counted as an exception, not a rule.
const RULE_FIELDS = ["customBlockedDomains", "customCosmeticRules", "customGrayscaleRules"] as const;
const EXCEPTION_FIELDS = ["disabledSites", "customAllowedDomains"] as const;

/** Order-insensitive-enough equality for this purpose: every field here is
 * either a primitive, a string array (compared as a set), or a small JSON-
 * safe record -- never a class instance, Map, or anything with
 * non-enumerable data. A false "changed" on key order alone is an
 * acceptable, rare over-count for a preview; a false "unchanged" (hiding a
 * real change from the user before they commit to overwriting everything)
 * would not be. */
function valuesDiffer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return true;
    const setA = new Set(a);
    return a.length !== setA.size || !b.every((v) => setA.has(v));
  }
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function summarizeSettingsImport(current: Settings, patch: Partial<Settings>): SettingsImportSummary {
  let protectionSettingsChanged = 0;
  let customRulesChanged = false;
  let siteExceptionsChanged = false;
  let filterListChoicesChanged = false;
  let syncSettingChanged = false;

  for (const [key, value] of Object.entries(patch)) {
    const field = key as keyof Settings;
    if (!valuesDiffer(current[field], value)) continue;

    if (typeof value === "boolean" && field !== "syncEnabled") {
      protectionSettingsChanged += 1;
    } else if (field === "syncEnabled") {
      syncSettingChanged = true;
    } else if (field === "filterGroups") {
      filterListChoicesChanged = true;
    } else if ((RULE_FIELDS as readonly string[]).includes(field)) {
      customRulesChanged = true;
    } else if ((EXCEPTION_FIELDS as readonly string[]).includes(field)) {
      siteExceptionsChanged = true;
    }
  }

  const isNoOp =
    protectionSettingsChanged === 0 && !customRulesChanged && !siteExceptionsChanged && !filterListChoicesChanged && !syncSettingChanged;

  return { protectionSettingsChanged, customRulesChanged, siteExceptionsChanged, filterListChoicesChanged, syncSettingChanged, isNoOp };
}

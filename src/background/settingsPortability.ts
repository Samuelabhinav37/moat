// Pure export/import logic for Settings, kept free of any webextension-polyfill
// import (same convention as filterGroupState.ts/managedPolicyMerge.ts) so it's
// testable without a browser extension context. Used by both the export/import
// message handlers in background/index.ts and the storage.sync mirror in
// settings.ts.
import { DEFAULT_SETTINGS, type Settings } from "../types";

export type ExportableSettings = Omit<Settings, "fingerprintSeed">;

/** fingerprintSeed is generated once per install (see settings.ts's
 * getOrCreateFingerprintSeed) and deliberately excluded from anything that
 * could carry it to another device -- each install should keep generating
 * its own. */
export function exportSettings(settings: Settings): ExportableSettings {
  const { fingerprintSeed: _fingerprintSeed, ...rest } = settings;
  return rest;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "boolean")
  );
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isStringArray)
  );
}

const STRING_ARRAY_FIELDS = new Set(["disabledSites", "customBlockedDomains", "customAllowedDomains"]);
const BOOLEAN_RECORD_FIELDS = new Set(["filterGroups"]);
const STRING_ARRAY_RECORD_FIELDS = new Set(["customCosmeticRules", "customGrayscaleRules"]);

/** Rejects the whole payload (returns null) rather than partially applying
 * anything malformed -- checks every DEFAULT_SETTINGS key present in the
 * payload against its expected shape; a field simply missing from an older
 * export is fine (patch semantics, same as setSettings elsewhere), but a
 * field present with the wrong shape means this probably isn't a real Moat
 * export and shouldn't be trusted at all. Unknown extra keys are ignored --
 * forward compatible with a newer export loaded into an older build. */
export function validateImportedSettings(value: unknown): Partial<Settings> | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === "fingerprintSeed") continue;
    if (!(key in candidate)) continue;
    const actual = candidate[key];

    if (STRING_ARRAY_FIELDS.has(key)) {
      if (!isStringArray(actual)) return null;
    } else if (BOOLEAN_RECORD_FIELDS.has(key)) {
      if (!isBooleanRecord(actual)) return null;
    } else if (STRING_ARRAY_RECORD_FIELDS.has(key)) {
      if (!isStringArrayRecord(actual)) return null;
    } else if (typeof actual !== "boolean") {
      return null;
    }
    patch[key] = actual;
  }
  return patch as Partial<Settings>;
}

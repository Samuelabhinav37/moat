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

// Bounds on every imported list/record field -- an import is untrusted file
// content (see validateImportedSettings below), and without a cap a single
// crafted export could balloon storage.local/storage.sync with an
// unbounded array. Generous enough that no real export (even a heavily
// customized one) would ever hit them.
const MAX_ARRAY_LENGTH = 5000;
const MAX_STRING_LENGTH = 500;
const MAX_RECORD_KEYS = 2000;

// Selectors are joined with "," and wrapped in a single `{...}` block by
// cosmeticSelectors.ts's buildStyleText/buildGrayscaleStyleText, then set via
// styleEl.textContent (never innerHTML, so this can't smuggle a <script> --
// textContent never re-enters the HTML parser). What it CAN do if left
// unvalidated: a selector containing "}" closes that block early and a
// following "{...}" opens a new one, letting an imported selector string
// inject an arbitrary extra CSS rule into every matching page instead of
// just hiding/graying one. None of these characters have any legitimate
// role in a CSS *selector* (as opposed to a full rule) -- a real selector
// never needs to open/close a declaration block itself.
const SELECTOR_DISALLOWED = /[{}<`]/;

function isPlausibleSelector(value: string): boolean {
  return value.length > 0 && value.length <= MAX_STRING_LENGTH && !SELECTOR_DISALLOWED.test(value);
}

function isBoundedStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ARRAY_LENGTH &&
    value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= MAX_STRING_LENGTH)
  );
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "boolean")
  );
}

/** Hostname -> selector[] shape (customCosmeticRules/customGrayscaleRules).
 * Bounds every layer -- number of hostnames, selectors per hostname, and
 * each selector's own content -- since this is the one place an untrusted
 * import file's string content ends up live in an injected stylesheet. */
function isSelectorMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_RECORD_KEYS) return false;
  return entries.every(
    ([hostname, selectors]) =>
      hostname.length > 0 &&
      hostname.length <= MAX_STRING_LENGTH &&
      Array.isArray(selectors) &&
      selectors.length <= MAX_ARRAY_LENGTH &&
      selectors.every((s) => typeof s === "string" && isPlausibleSelector(s))
  );
}

const STRING_ARRAY_FIELDS = new Set(["disabledSites", "customBlockedDomains", "customAllowedDomains"]);
const BOOLEAN_RECORD_FIELDS = new Set(["filterGroups"]);
const SELECTOR_MAP_FIELDS = new Set(["customCosmeticRules", "customGrayscaleRules"]);

/** Rejects the whole payload (returns null) rather than partially applying
 * anything malformed -- checks every DEFAULT_SETTINGS key present in the
 * payload against its expected shape; a field simply missing from an older
 * export is fine (patch semantics, same as setSettings elsewhere), but a
 * field present with the wrong shape means this probably isn't a real Moat
 * export and shouldn't be trusted at all. Unknown extra keys are ignored --
 * forward compatible with a newer export loaded into an older build.
 *
 * Goes beyond a pure shape check for two fields: customCosmeticRules/
 * customGrayscaleRules' selector strings end up live in an injected
 * stylesheet (see cosmeticSelectors.ts), so isSelectorMap also rejects
 * characters a real CSS selector never needs but that could otherwise close
 * out the wrapping `{...}` block early and inject an unrelated rule. Every
 * array/record field is also length-capped -- an import is untrusted file
 * content, not just untrusted shape. */
export function validateImportedSettings(value: unknown): Partial<Settings> | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === "fingerprintSeed") continue;
    if (!(key in candidate)) continue;
    const actual = candidate[key];

    if (STRING_ARRAY_FIELDS.has(key)) {
      if (!isBoundedStringArray(actual)) return null;
    } else if (BOOLEAN_RECORD_FIELDS.has(key)) {
      if (!isBooleanRecord(actual)) return null;
    } else if (SELECTOR_MAP_FIELDS.has(key)) {
      if (!isSelectorMap(actual)) return null;
    } else if (typeof actual !== "boolean") {
      return null;
    }
    patch[key] = actual;
  }
  return patch as Partial<Settings>;
}

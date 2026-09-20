// Pure merge logic pulled out of managedPolicy.ts (which imports
// webextension-polyfill and throws on import outside a real extension
// context) so it's testable without a browser environment.
import type { ManagedPolicy, Settings } from "../types";

// managedPolicy.ts casts whatever browser.storage.managed.get() returns
// straight to ManagedPolicy with no runtime check at all -- Chrome/Firefox
// validate against managed_schema.json before the extension ever sees a
// managed value, but that's a guarantee about the platform's policy
// delivery, not about this function's own inputs, and a schema gap or an
// admin editing the underlying registry/plist directly (possible on some
// platforms) could still hand this a wrong-shaped value. A wrong-typed
// managedCustomBlockedDomains is the dangerous case specifically:
// `[...someString]` spreads individual CHARACTERS, not domains, silently
// corrupting the block-list with garbage single-character entries rather
// than throwing or no-oping.
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "boolean")
  );
}

/**
 * Computes the *effective* settings: managed values win over the user's own
 * when the corresponding lock flag is set; when not locked, a managed value
 * still supplies the default but the user's own choice (if any) wins.
 * managedCustomBlockedDomains is always additive, lock or not -- it's an
 * extra blocklist, not a toggle the user could sensibly "override" away.
 */
export function applyManagedOverrides(settings: Settings, policy: ManagedPolicy): Settings {
  const effective: Settings = { ...settings };

  if (policy.forceEnabled) {
    effective.enabled = true;
    // Forcing protection on only means something if per-site pauses can't
    // quietly undo it.
    effective.disabledSites = [];
  }

  if (policy.managedFilterGroups && isBooleanRecord(policy.managedFilterGroups)) {
    effective.filterGroups = policy.lockFilterGroups
      ? { ...settings.filterGroups, ...policy.managedFilterGroups }
      : { ...policy.managedFilterGroups, ...settings.filterGroups };
  }

  if (policy.managedCustomBlockedDomains?.length && isStringArray(policy.managedCustomBlockedDomains)) {
    effective.customBlockedDomains = [
      ...new Set([...settings.customBlockedDomains, ...policy.managedCustomBlockedDomains]),
    ];
  }

  return effective;
}

/** Whether a given settings field should be disabled/greyed out in the UI.
 *
 * lockProtectionToggle alone only locks the *toggle in the UI* -- it does
 * not itself force effective.enabled=true (see applyManagedOverrides
 * above, which only does that for forceEnabled). An admin who sets
 * lockProtectionToggle without also setting forceEnabled on a user who had
 * already disabled protection leaves it permanently stuck off, with the
 * toggle greyed out and no way for the user to fix it. Set both together
 * for the "protection must always be on" enterprise case. */
export function isLocked(field: "protection" | "filterGroups", policy: ManagedPolicy): boolean {
  if (field === "protection") return Boolean(policy.lockProtectionToggle || policy.forceEnabled);
  return Boolean(policy.lockFilterGroups);
}

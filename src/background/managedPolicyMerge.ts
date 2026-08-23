// Pure merge logic pulled out of managedPolicy.ts (which imports
// webextension-polyfill and throws on import outside a real extension
// context) so it's testable without a browser environment.
import type { ManagedPolicy, Settings } from "../types";

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

  if (policy.managedFilterGroups) {
    effective.filterGroups = policy.lockFilterGroups
      ? { ...settings.filterGroups, ...policy.managedFilterGroups }
      : { ...policy.managedFilterGroups, ...settings.filterGroups };
  }

  if (policy.managedCustomBlockedDomains?.length) {
    effective.customBlockedDomains = [
      ...new Set([...settings.customBlockedDomains, ...policy.managedCustomBlockedDomains]),
    ];
  }

  return effective;
}

/** Whether a given settings field should be disabled/greyed out in the UI. */
export function isLocked(field: "protection" | "filterGroups", policy: ManagedPolicy): boolean {
  if (field === "protection") return Boolean(policy.lockProtectionToggle || policy.forceEnabled);
  return Boolean(policy.lockFilterGroups);
}

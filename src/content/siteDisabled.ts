// Shared by every isolated-world content script that needs to know whether
// protection is paused here, and/or its own feature flag -- bridge.ts (feeds
// it to the MAIN-world guard), cosmeticFilter.ts, consentRejector.ts,
// leakedPasswordCheck.ts, feedAdScanner.ts, and youtubeAdDimmer.ts.
//
// Deliberately imports only managedPolicy.ts, not the full background/
// settings.ts -- that module also pulls in filterGroups/customRules/
// privacySettings application logic that content scripts have no use for
// and shouldn't carry into their bundle.
import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from "../types";
import { getManagedPolicy, applyManagedOverrides } from "../background/managedPolicy";

/** Single storage.local read (+ managed-policy merge) for every check a
 * content script needs on this page -- the disabled-here check and any of
 * its own feature flags -- so callers that need both don't each pay for
 * their own separate storage.local.get of the same settings blob. */
export async function getEffectiveSettingsHere(): Promise<Settings> {
  const [stored, policy] = await Promise.all([browser.storage.local.get(STORAGE_KEY), getManagedPolicy()]);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) };
  return applyManagedOverrides(settings, policy);
}

export function isDisabled(effective: Settings): boolean {
  return !effective.enabled || effective.disabledSites.includes(location.hostname);
}

/** Convenience wrapper for callers that only need the boolean and have no
 * other use for the rest of the settings object. */
export async function isDisabledHere(): Promise<boolean> {
  return isDisabled(await getEffectiveSettingsHere());
}

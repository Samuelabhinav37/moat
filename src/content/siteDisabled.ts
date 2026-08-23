// Shared by every isolated-world content script that needs to know whether
// protection is paused here -- bridge.ts (feeds it to the MAIN-world guard)
// and cosmeticFilter.ts (skips injecting hidden-element CSS when paused).
//
// Deliberately imports only managedPolicy.ts, not the full background/
// settings.ts -- that module also pulls in filterGroups/customRules/
// privacySettings application logic that content scripts have no use for
// and shouldn't carry into their bundle.
import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from "../types";
import { getManagedPolicy, applyManagedOverrides } from "../background/managedPolicy";

export async function isDisabledHere(): Promise<boolean> {
  const [stored, policy] = await Promise.all([browser.storage.local.get(STORAGE_KEY), getManagedPolicy()]);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) };
  const effective = applyManagedOverrides(settings, policy);
  return !effective.enabled || effective.disabledSites.includes(location.hostname);
}

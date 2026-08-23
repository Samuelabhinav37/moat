// Shared by every isolated-world content script that needs to know whether
// protection is paused here -- bridge.ts (feeds it to the MAIN-world guard)
// and cosmeticFilter.ts (skips injecting hidden-element CSS when paused).
import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from "../types";

export async function isDisabledHere(): Promise<boolean> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) };
  return !settings.enabled || settings.disabledSites.includes(location.hostname);
}

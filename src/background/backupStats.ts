// storage.local-only record of when the user last exported their settings to
// a file (DR-15's Backup tab hero value + rail dot). Kept out of
// Settings/STORAGE_KEY entirely, same never-synced/never-exported posture as
// usageStats.ts/customRuleStats.ts -- this is a fact about this device's own
// backup habits, not something the settings-export/import payload or the
// storage.sync mirror should carry. Importing someone else's exported
// settings must not silently claim you've backed up your own.
import browser from "webextension-polyfill";

const LAST_BACKUP_AT_KEY = "lastBackupAt";

export async function getLastBackupAt(): Promise<number | null> {
  const stored = await browser.storage.local.get(LAST_BACKUP_AT_KEY);
  return (stored[LAST_BACKUP_AT_KEY] as number | undefined) ?? null;
}

export async function recordBackupTaken(): Promise<void> {
  await browser.storage.local.set({ [LAST_BACKUP_AT_KEY]: Date.now() });
}

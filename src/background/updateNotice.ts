// Tracks two purely transient UI-bookkeeping flags -- "has this install been
// updated since the popup last saw it" and "has this install ever seen the
// first-run card" -- under their own storage key, deliberately separate from
// Settings/STORAGE_KEY. Neither is a user preference: they don't belong in
// settingsPortability.ts's export/import payload or the storage.sync mirror
// (see settings.ts), and mixing them into Settings would leak transient
// state into a file the user might save/share.
import browser from "webextension-polyfill";
import { shouldShowUpdateNotice } from "../shared/updateNoticeLogic";

export { shouldShowUpdateNotice };

const UI_STATE_KEY = "uiState";

interface UiState {
  lastSeenVersion?: string;
  hasSeenOnboarding?: boolean;
}

async function getUiState(): Promise<UiState> {
  const stored = await browser.storage.local.get(UI_STATE_KEY);
  return (stored[UI_STATE_KEY] as UiState | undefined) ?? {};
}

async function setUiState(patch: Partial<UiState>): Promise<void> {
  const current = await getUiState();
  await browser.storage.local.set({ [UI_STATE_KEY]: { ...current, ...patch } });
}

/** Call unconditionally from onInstalled, for both "install" and "update" --
 * on a first-ever install this just records the baseline version (no prior
 * lastSeenVersion to compare against, so no notice), which is exactly what
 * lets the *next* real update be correctly detected. Only ever writes
 * lastSeenVersion; the popup itself owns dismissing the notice once shown
 * (dismissUpdateNotice below) and the onboarding flag is unrelated to
 * install/update events entirely (see dismissOnboarding). */
export async function recordUpdateSeen(): Promise<void> {
  const currentVersion = browser.runtime.getManifest().version;
  const { lastSeenVersion } = await getUiState();
  if (lastSeenVersion === currentVersion) return; // already recorded, avoid a redundant write
  await setUiState({ lastSeenVersion: currentVersion });
}

export interface PopupUiNotices {
  /** True only when the version actually changed since it was last recorded
   * -- never true right after a fresh install. */
  updateAvailable: boolean;
  updateVersion: string;
  showOnboarding: boolean;
}

/** Read by the popup on every render. */
export async function getPopupUiNotices(): Promise<PopupUiNotices> {
  const state = await getUiState();
  const currentVersion = browser.runtime.getManifest().version;
  return {
    updateAvailable: shouldShowUpdateNotice(currentVersion, state.lastSeenVersion),
    updateVersion: currentVersion,
    showOnboarding: state.hasSeenOnboarding !== true,
  };
}

/** The popup calls this once the notice has been shown/clicked, so it
 * doesn't reappear on the next open. Recording the current version as
 * "seen" (rather than a separate boolean) reuses the exact same
 * lastSeenVersion field recordUpdateSeen() writes -- one source of truth. */
export async function dismissUpdateNotice(): Promise<void> {
  await setUiState({ lastSeenVersion: browser.runtime.getManifest().version });
}

export async function dismissOnboarding(): Promise<void> {
  await setUiState({ hasSeenOnboarding: true });
}

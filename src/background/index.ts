import browser, { type Runtime } from "webextension-polyfill";
import {
  combinedBreakdown,
  combinedCompanyBreakdown,
  combinedTotal,
  forgetTab,
  recordDynamicCatch,
  refreshStaticBreakdown,
  resetForNavigation,
} from "./blockStats";
import {
  addCustomCosmeticRule,
  addGrayscaleRule,
  getEffectiveSettings,
  getSettings,
  isSiteDisabled,
  reapplySettings,
  seedFromSyncIfEmpty,
  setSettings,
  setSiteDisabled,
} from "./settings";
import { exportSettings, validateImportedSettings } from "./settingsPortability";
import { dismissOnboarding, dismissUpdateNotice, getPopupUiNotices, recordUpdateSeen } from "./updateNotice";
import { initPopupGuard } from "./popupGuard";
import { initLiveUpdates } from "./liveUpdates";
import { forgetTab as forgetLoggerTab, getEntries as getLoggedEntries, initRuleLogger, isSupported as isLoggerSupported } from "./ruleLogger";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import { summarizeFilterLists } from "../shared/rulesetManifest";
import { effectiveFilterGroupState } from "./filterGroupState";
import type {
  ImportSettingsResponse,
  LogEntriesResponse,
  ReportContextResponse,
  RuntimeMessage,
  StatusResponse,
} from "../types";
import type { PopupUiNotices } from "./updateNotice";

initPopupGuard();
initLiveUpdates();
initRuleLogger();
// storage.session defaults to background/extension-page-only access; the
// opt-in per-session fingerprint rotation toggle needs bridge.ts (a content
// script) to read/write it too. Untyped in webextension-polyfill's storage
// types even though both Chrome and Firefox support it (see MDN's
// StorageArea.setAccessLevel), hence the loose cast. Best-effort: if this
// fails (older browser, API missing), bridge.ts's session-seed read just
// falls back to the permanent seed instead of throwing.
type SessionAccessArea = { setAccessLevel(options: { accessLevel: string }): Promise<void> };
void (browser.storage.session as unknown as SessionAccessArea)
  .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
  .catch(() => {
    // Older browser or API missing -- rotation silently falls back to the permanent seed.
  });
// Note: not a top-level `await` -- this module is built as a Rollup `iife`
// bundle (see scripts/build.mjs), which doesn't support it.
void seedFromSyncIfEmpty().then(() => reapplySettings());

// Fires on both "install" and "update" -- on a fresh install this only
// records the baseline version (there's nothing to compare against yet, so
// no notice), which is exactly what lets the *next* real update be detected.
browser.runtime.onInstalled.addListener(() => {
  void recordUpdateSeen();
});

// An admin can push/change managed policy at any point during a session
// (not just at browser startup) -- reapply everything when that happens,
// same as we already do for the user's own settings changes.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "managed") void reapplySettings();
});

browser.commands.onCommand.addListener((command) => {
  if (command !== "toggle-protection") return;
  void (async () => {
    const current = await getEffectiveSettings();
    await setSettings({ enabled: !current.enabled });
  })();
});

browser.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  forgetLoggerTab(tabId);
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) resetForNavigation(details.tabId);
});

// Static ads/trackers/popups counts come from declarativeNetRequest's own
// match feedback, which is only meaningful once the page has actually
// finished loading and made its requests -- hence onCompleted, not
// onCommitted (which only clears the stale numbers from the previous page).
browser.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) void refreshStaticBreakdown(details.tabId);
});

function hostnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return typeof value === "object" && value !== null && "type" in value;
}

// hostname/selector arrive from a sender the TS types trust unconditionally
// (only Moat's own elementPicker.ts sends these today), but the listener
// itself shouldn't -- a compact, independent check at this boundary so it
// stays safe against any future sender, not just the current one.
const MAX_MESSAGE_STRING_LENGTH = 2000;

function isValidMessageString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_MESSAGE_STRING_LENGTH;
}

browser.runtime.onMessage.addListener((raw: unknown, sender: Runtime.MessageSender) => {
  if (!isRuntimeMessage(raw)) return undefined;
  const message = raw;

  switch (message.type) {
    case "blocked": {
      if (sender.tab?.id !== undefined) void recordDynamicCatch(sender.tab.id);
      return undefined;
    }

    case "get-status": {
      return (async (): Promise<StatusResponse> => {
        // Content scripts have a sender.tab; popup.html/options.html don't,
        // so fall back to whichever tab the user is currently looking at.
        const tab = sender.tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
        const hostname = hostnameOf(tab?.url);
        const settings = await getEffectiveSettings();
        return {
          hostname,
          siteDisabled: hostname ? await isSiteDisabled(hostname) : false,
          enabled: settings.enabled,
          blockedOnTab: tab?.id !== undefined ? combinedTotal(tab.id) : 0,
          breakdown: tab?.id !== undefined ? combinedBreakdown(tab.id) : { ads: 0, trackers: 0, popups: 0 },
          companyBreakdown: tab?.id !== undefined ? combinedCompanyBreakdown(tab.id) : {},
        };
      })();
    }

    case "toggle-site": {
      if (!isValidMessageString(message.hostname)) return undefined;
      return setSiteDisabled(message.hostname, message.disabled).then(() => undefined);
    }

    case "save-cosmetic-rule": {
      if (!isValidMessageString(message.hostname) || !isValidMessageString(message.selector)) return undefined;
      return addCustomCosmeticRule(message.hostname, message.selector).then(() => undefined);
    }

    case "save-grayscale-rule": {
      if (!isValidMessageString(message.hostname) || !isValidMessageString(message.selector)) return undefined;
      return addGrayscaleRule(message.hostname, message.selector).then(() => undefined);
    }

    case "get-report-context": {
      return (async (): Promise<ReportContextResponse> => {
        const tab = sender.tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
        const settings = await getEffectiveSettings();
        const manifest = await loadRulesetManifest();
        const lists = summarizeFilterLists(manifest);
        const state = effectiveFilterGroupState(settings.enabled, settings.filterGroups, lists.map((l) => l.group));
        return {
          hostname: hostnameOf(tab?.url),
          enabledFilterGroups: lists.filter((l) => state[l.group]).map((l) => l.name),
        };
      })();
    }

    case "export-settings": {
      // Deliberately getSettings() (raw), never getEffectiveSettings() -- an
      // org's managed-policy-forced values must never be exported as if
      // they were the user's own preference (see settingsPortability.ts).
      return (async () => exportSettings(await getSettings()))();
    }

    case "import-settings": {
      return (async (): Promise<ImportSettingsResponse> => {
        const patch = validateImportedSettings(message.payload);
        if (patch === null) return { ok: false };
        await setSettings(patch);
        return { ok: true };
      })();
    }

    case "get-ui-notices": {
      return (async (): Promise<PopupUiNotices> => getPopupUiNotices())();
    }

    case "dismiss-update-notice": {
      return dismissUpdateNotice();
    }

    case "dismiss-onboarding": {
      return dismissOnboarding();
    }

    case "get-log-entries": {
      return (async (): Promise<LogEntriesResponse> => {
        const tab = sender.tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
        return {
          supported: isLoggerSupported(),
          hostname: hostnameOf(tab?.url),
          entries: tab?.id !== undefined ? getLoggedEntries(tab.id) : [],
        };
      })();
    }

    default:
      return undefined;
  }
});

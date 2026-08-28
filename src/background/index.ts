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
  applyFreshInstallDefaults,
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
import { getManagedPolicy } from "./managedPolicy";
import { initAthenaIntegration, queueSecurityEvent } from "./athenaIntegration";
import { isPolicyBlockedHostname } from "./athenaPolicySync";
import { forgetTab as forgetBlockReasonTab, getBlockedHostname, recordBlockedHostname } from "./athenaBlockReason";
import { safeHostname } from "./redirectDomainMatch";
import { forgetTab as forgetLoggerTab, getEntries as getLoggedEntries, initRuleLogger, isSupported as isLoggerSupported } from "./ruleLogger";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import { summarizeFilterLists } from "../shared/rulesetManifest";
import { effectiveFilterGroupState } from "./filterGroupState";
import type {
  AthenaBlockReasonResponse,
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
// No-op on every normal install -- see athenaIntegration.ts. Only does
// anything once an org's own managed policy provisions ManagedPolicy.athena.
initAthenaIntegration(getManagedPolicy);
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
// Shared by both call sites below. seedFromSyncIfEmpty/applyFreshInstallDefaults
// each independently check "is storage.local genuinely still empty?" right
// before writing, so calling this twice in a row (once from the
// unconditional bootstrap below, once from onInstalled when it fires) is
// safe -- whichever runs first wins, and the other becomes a no-op. What
// matters is the ORDER *within* one call: seed-from-sync must get its
// chance before the fresh-install lite defaults do, so a real synced
// settings copy from another device always wins over the generic default.
async function initializeSettings(reason?: Runtime.OnInstalledReason): Promise<void> {
  await seedFromSyncIfEmpty();
  if (reason === "install") await applyFreshInstallDefaults();
  await reapplySettings();
}

// Note: not a top-level `await` -- this module is built as a Rollup `iife`
// bundle (see scripts/build.mjs), which doesn't support it. No reason here --
// this path covers ordinary service-worker wake-ups (browser restart, SW
// idle timeout) where onInstalled never fires at all.
void initializeSettings();

// Fires on "install", "update", and "browser_update". On a fresh install
// this both records the baseline version (there's nothing to compare
// against yet, so no notice -- which is exactly what lets the *next* real
// update be detected) and seeds the smaller "lite" filter-group defaults;
// on every other reason, initializeSettings behaves the same as the
// unconditional call above.
browser.runtime.onInstalled.addListener((details) => {
  void recordUpdateSeen();
  void initializeSettings(details.reason);
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
  forgetBlockReasonTab(tabId);
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) resetForNavigation(details.tabId);
});

// Fires with the ORIGINAL requested URL, before declarativeNetRequest's
// redirect (see athenaPolicyRules.ts) ever resolves -- the one point where
// the extension can still see what a tab was actually trying to reach.
// isPolicyBlockedHostname is a plain in-memory Set lookup (see
// athenaPolicySync.ts), so this is cheap on every normal install too, where
// the set is always empty and this always no-ops.
browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  const hostname = safeHostname(details.url);
  if (hostname && isPolicyBlockedHostname(hostname)) recordBlockedHostname(details.tabId, hostname);
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
// Deliberately smaller than the general cap above: this is the one message
// carrying free text a user typed, headed to an org's Athena instance (see
// the "override" case below) -- capped independently rather than just
// reusing the general limit.
const MAX_OVERRIDE_REASON_LENGTH = 500;

function isValidMessageString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_MESSAGE_STRING_LENGTH;
}

browser.runtime.onMessage.addListener((raw: unknown, sender: Runtime.MessageSender) => {
  if (!isRuntimeMessage(raw)) return undefined;
  const message = raw;

  switch (message.type) {
    case "blocked": {
      if (sender.tab?.id !== undefined) void recordDynamicCatch(sender.tab.id);
      // Cross-browser event source (unlike the getMatchedRules-based one in
      // matchStats.ts, which is Chrome-only) -- no-ops instantly on every
      // normal install, same as that one.
      void getManagedPolicy().then((policy) =>
        queueSecurityEvent(policy, { category: "popup-redirect", riskTier: "medium" })
      );
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

    case "get-athena-block-reason": {
      return (async (): Promise<AthenaBlockReasonResponse> => ({
        hostname: sender.tab?.id !== undefined ? getBlockedHostname(sender.tab.id) : null,
      }))();
    }

    case "report-athena-override": {
      // Logged, not an instant local unblock -- see warning.ts's own
      // comment and the README's Athena-integration section for why: an
      // org's Athena instance reviewing and re-pushing an updated policy is
      // the actual mechanism that lifts a block, matching Athena's own
      // "a human approves" governing rule rather than a self-service bypass.
      if (typeof message.reason !== "string" || message.reason.length === 0 || message.reason.length > MAX_OVERRIDE_REASON_LENGTH) {
        return undefined;
      }
      if (sender.tab?.id === undefined) return undefined;
      const hostname = getBlockedHostname(sender.tab.id);
      if (!hostname) return undefined;
      return getManagedPolicy().then((policy) =>
        queueSecurityEvent(policy, { category: "override", riskTier: "low", domain: hostname, note: message.reason })
      );
    }

    default:
      return undefined;
  }
});

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
  isSiteDisabled,
  reapplySettings,
  setSettings,
  setSiteDisabled,
} from "./settings";
import { initPopupGuard } from "./popupGuard";
import { initLiveUpdates } from "./liveUpdates";
import { forgetTab as forgetLoggerTab, getEntries as getLoggedEntries, initRuleLogger, isSupported as isLoggerSupported } from "./ruleLogger";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import { summarizeFilterLists } from "../shared/rulesetManifest";
import { effectiveFilterGroupState } from "./filterGroupState";
import type { LogEntriesResponse, ReportContextResponse, RuntimeMessage, StatusResponse } from "../types";

initPopupGuard();
initLiveUpdates();
initRuleLogger();
void reapplySettings();

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

import browser, { type Runtime } from "webextension-polyfill";
import { combinedBreakdown, combinedTotal, forgetTab, recordDynamicCatch, refreshStaticBreakdown, resetForNavigation } from "./blockStats";
import {
  addCustomCosmeticRule,
  addGrayscaleRule,
  getEffectiveSettings,
  isSiteDisabled,
  reapplySettings,
  setSiteDisabled,
} from "./settings";
import { initPopupGuard } from "./popupGuard";
import { initLiveUpdates } from "./liveUpdates";
import type { RuntimeMessage, StatusResponse } from "../types";

initPopupGuard();
initLiveUpdates();
void reapplySettings();

// An admin can push/change managed policy at any point during a session
// (not just at browser startup) -- reapply everything when that happens,
// same as we already do for the user's own settings changes.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "managed") void reapplySettings();
});

browser.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

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

browser.runtime.onMessage.addListener((raw: unknown, sender: Runtime.MessageSender) => {
  const message = raw as RuntimeMessage;

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
        };
      })();
    }

    case "toggle-site": {
      return setSiteDisabled(message.hostname, message.disabled).then(() => undefined);
    }

    case "save-cosmetic-rule": {
      return addCustomCosmeticRule(message.hostname, message.selector).then(() => undefined);
    }

    case "save-grayscale-rule": {
      return addGrayscaleRule(message.hostname, message.selector).then(() => undefined);
    }

    default:
      return undefined;
  }
});

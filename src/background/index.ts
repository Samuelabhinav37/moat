import browser, { type Runtime } from "webextension-polyfill";
import { getCount, recordBlock, resetCount, forgetTab } from "./badge";
import { getEffectiveSettings, isSiteDisabled, reapplySettings, setSettings, setSiteDisabled } from "./settings";
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
  if (details.frameId === 0) resetCount(details.tabId);
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
      if (sender.tab?.id !== undefined) void recordBlock(sender.tab.id);
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
          blockedOnTab: tab?.id !== undefined ? getCount(tab.id) : 0,
        };
      })();
    }

    case "toggle-site": {
      return setSiteDisabled(message.hostname, message.disabled).then(() => undefined);
    }

    case "set-enabled": {
      return setSettings({ enabled: message.enabled }).then(() => undefined);
    }

    default:
      return undefined;
  }
});

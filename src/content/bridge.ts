// Isolated-world content script: the only piece of the content-script pair
// with access to extension APIs. Tells mainWorldGuard.ts whether this site
// is paused, and relays its block reports back to the background worker.
import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type BridgeMessage, type BlockedMessage, type Settings } from "../types";

async function isDisabledHere(): Promise<boolean> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) };
  return !settings.enabled || settings.disabledSites.includes(location.hostname);
}

async function sendConfig(): Promise<void> {
  const disabled = await isDisabledHere();
  const message: BridgeMessage = { source: "silent-adblock", type: "config", disabled };
  window.postMessage(message, "*");
}

void sendConfig();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) void sendConfig();
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeMessage | undefined;
  if (!data || data.source !== "silent-adblock" || data.type !== "blocked") return;

  const message: BlockedMessage = { type: "blocked", kind: data.kind, url: data.url };
  browser.runtime.sendMessage(message).catch(() => {
    // Background worker may be restarting; the block already happened
    // client-side, so a missed badge tick isn't worth retrying.
  });
});

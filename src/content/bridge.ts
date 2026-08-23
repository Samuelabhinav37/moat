// Isolated-world content script: the only piece of the content-script pair
// with access to extension APIs. Tells the MAIN-world guards (popup guard,
// fingerprint guard) whether this site is paused and what to do, and
// relays their block reports back to the background worker.
import browser from "webextension-polyfill";
import { STORAGE_KEY, type BridgeMessage, type BlockedMessage } from "../types";
import { getOrCreateFingerprintSeed, getSettings } from "../background/settings";

async function sendConfig(): Promise<void> {
  const settings = await getSettings();
  const disabled = !settings.enabled || settings.disabledSites.includes(location.hostname);
  const fingerprintResistance = settings.fingerprintResistance && !disabled;
  const fingerprintSeed = fingerprintResistance ? await getOrCreateFingerprintSeed() : "";

  const message: BridgeMessage = { source: "silent-adblock", type: "config", disabled, fingerprintResistance, fingerprintSeed };
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

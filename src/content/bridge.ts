// Isolated-world content script: the only piece of the content-script pair
// with access to extension APIs. Tells the MAIN-world guards (popup guard,
// fingerprint guard) whether this site is paused and what to do, and
// relays their block reports back to the background worker.
import browser from "webextension-polyfill";
import { STORAGE_KEY, type BridgeMessage, type BlockedMessage } from "../types";
import { getEffectiveSettings, getOrCreateFingerprintSeed } from "../background/settings";

// One token per page load, sent with every config message so the MAIN-world
// guards can tell a real update from a later message spoofed by the page
// itself (same-window postMessage has no other origin check available).
const guardToken = crypto.randomUUID();

async function sendConfig(): Promise<void> {
  const settings = await getEffectiveSettings();
  const disabled = !settings.enabled || settings.disabledSites.includes(location.hostname);
  const fingerprintResistance = settings.fingerprintResistance && !disabled;
  const fingerprintSeed = fingerprintResistance ? await getOrCreateFingerprintSeed() : "";

  const message: BridgeMessage = {
    source: "moat",
    type: "config",
    disabled,
    fingerprintResistance,
    fingerprintSeed,
    guardToken,
  };
  window.postMessage(message, "*");
}

void sendConfig();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "managed" || (area === "local" && STORAGE_KEY in changes)) void sendConfig();
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeMessage | undefined;
  if (!data || data.source !== "moat" || data.type !== "blocked") return;

  const message: BlockedMessage = { type: "blocked", kind: data.kind, url: data.url };
  browser.runtime.sendMessage(message).catch(() => {
    // Background worker may be restarting; the block already happened
    // client-side, so a missed badge tick isn't worth retrying.
  });
});

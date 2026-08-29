// Isolated-world content script: the only piece of the content-script pair
// with access to extension APIs. Tells the MAIN-world guards (popup guard,
// fingerprint guard) whether this site is paused and what to do, and
// relays their block reports back to the background worker.
import browser from "webextension-polyfill";
import { STORAGE_KEY, type BridgeMessage, type BlockedMessage } from "../types";
import { getEffectiveSettings, getOrCreateFingerprintSeed, getOrCreateSessionFingerprintSeed } from "../background/settings";

// One token per page load, sent with every config message so the MAIN-world
// guards can tell a real update from a later message spoofed by the page
// itself (same-window postMessage has no other origin check available).
const guardToken = crypto.randomUUID();

// Claim the guards' trust-on-first-use slot *synchronously*, before any page
// script runs. This content script executes ahead of the page's first
// <script>, so this postMessage task is enqueued first; the real values in
// sendConfig() only go out after an async storage read, which a page script
// could otherwise beat -- locking the guards to a token the page chose and
// pinning e.g. disabled:true (popup guard off) or a known fingerprint seed.
// The placeholder values here match the guards' own pre-config defaults
// (siteDisabled / active both start false), so this changes nothing
// functionally; sendConfig() delivers the real values under the same token.
function claimGuardToken(): void {
  const message: BridgeMessage = {
    source: "moat",
    type: "config",
    disabled: false,
    fingerprintResistance: false,
    fingerprintSeed: "",
    guardToken,
  };
  window.postMessage(message, "*");
}

async function sendConfig(): Promise<void> {
  const settings = await getEffectiveSettings();
  const disabled = !settings.enabled || settings.disabledSites.includes(location.hostname);
  const fingerprintResistance = settings.fingerprintResistance && !disabled;
  const fingerprintSeed = fingerprintResistance
    ? settings.fingerprintRotatePerSession
      ? // storage.session needs the background worker to have already called
        // setAccessLevel (see background/index.ts) before a content script
        // can reach it -- on the very first page load after a browser
        // restart that call might not have landed yet, so fall back to the
        // permanent seed rather than fail the whole config message.
        await getOrCreateSessionFingerprintSeed().catch(() => getOrCreateFingerprintSeed())
      : await getOrCreateFingerprintSeed()
    : "";

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

claimGuardToken();
void sendConfig();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "managed" || (area === "local" && STORAGE_KEY in changes)) void sendConfig();
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeMessage | undefined;
  if (!data || data.source !== "moat" || data.type !== "blocked") return;
  // Only the MAIN-world guards know the token from the config message above;
  // a "blocked" message the page posted itself won't carry it. Without this
  // check a page could inflate the badge or, on an Athena-connected install,
  // feed the org a fabricated popup-redirect security event (see
  // background/index.ts's "blocked" handler).
  if (data.guardToken !== guardToken) return;

  const message: BlockedMessage = { type: "blocked", kind: data.kind, url: data.url };
  browser.runtime.sendMessage(message).catch(() => {
    // Background worker may be restarting; the block already happened
    // client-side, so a missed badge tick isn't worth retrying.
  });
});

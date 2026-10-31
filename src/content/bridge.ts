// Isolated-world content script: the only piece of the content-script pair
// with access to extension APIs. Tells the MAIN-world guards (popup guard,
// fingerprint guard) whether this site is paused and what to do, and
// relays their block reports back to the background worker.
import browser from "webextension-polyfill";
import {
  BRIDGE_READY_EVENT,
  GUARD_CONNECT_EVENT,
  POPUP_GUARD_HELLO_EVENT,
  STORAGE_KEY,
  type BlockedMessage,
  type FingerprintGuardConfig,
  type GuardBlockReport,
  type PopupGuardConfig,
  type Settings,
  type FingerprintSeedResponse,
  type GetFingerprintSeedMessage,
  type RecordUsageSignalMessage,
} from "../types";
import { getEffectiveSettings } from "../background/settings";
import { matchesDomainOrSubdomain } from "../shared/domainChain";
import { isLoopbackHost } from "../shared/loopback";
import { effectiveValue } from "../shared/perSiteOverrides";

// Routed through the background worker rather than calling
// getOrCreateFingerprintSeed/getOrCreateSessionFingerprintSeed directly the
// way getEffectiveSettings (a plain read) is above -- this content script
// is instantiated fresh per tab/frame, so two tabs generating a seed
// directly would each run that module's generate-if-absent logic in their
// own separate copy of it, with no shared state to serialize against.
// Routing through the one background worker (which every tab's request
// funnels through) is what actually makes "one seed per browser session"
// hold; see types.ts's GetFingerprintSeedMessage.
async function fetchFingerprintSeed(session: boolean): Promise<FingerprintSeedResponse> {
  const message: GetFingerprintSeedMessage = { type: "get-fingerprint-seed", session };
  return (await browser.runtime.sendMessage(message)) as FingerprintSeedResponse;
}

// The fingerprint guard's private channel, handed over synchronously below.
const fingerprintChannel = new MessageChannel();

// The popup guard's port, from its hello (POPUP_GUARD_HELLO_EVENT in
// types.ts). Taken once, and kept only if Moat is on for this page: on a
// paused page there's no guard, so a hello there can only be a page
// script's, and it gets nothing back.
let popupGuardPort: MessagePort | null = null;
let popupGuardHelloTaken = false;
let pageDisabled = true;

function isDisabled(settings: Settings): boolean {
  return (
    !settings.enabled ||
    isLoopbackHost(location.hostname) ||
    matchesDomainOrSubdomain(location.hostname, settings.disabledSites)
  );
}

document.addEventListener(POPUP_GUARD_HELLO_EVENT, (event) => {
  const port = (event as MessageEvent).ports?.[0];
  if (popupGuardHelloTaken || !port) return;
  popupGuardHelloTaken = true;
  event.preventDefault();
  void getEffectiveSettings().then((settings) => {
    // A guard that loaded just before the site was paused stays as it is
    // until the page reloads, which is when the pause takes hold anyway.
    if (isDisabled(settings)) return port.close();
    pageDisabled = false;
    popupGuardPort = port;
    port.onmessage = forwardGuardReport;
    port.postMessage({ disabled: false } satisfies PopupGuardConfig);
  });
});

// This content script runs at document_start, after the fingerprint guard
// (earlier in the manifest) and before any page script. dispatchEvent is
// synchronous, so the guard takes its port right here, and no page script
// exists yet to see the event or the port. Ports cross from this isolated
// world into the page's world (checked in Chrome).
function connectGuards(): void {
  document.dispatchEvent(new MessageEvent(GUARD_CONNECT_EVENT, { ports: [fingerprintChannel.port2] }));
  // For a popup guard that loaded before this script.
  document.dispatchEvent(new Event(BRIDGE_READY_EVENT));
}

async function sendConfig(): Promise<void> {
  const settings = await getEffectiveSettings();
  const disabled = isDisabled(settings);
  pageDisabled = disabled;
  const fingerprintResistance =
    effectiveValue(settings, location.hostname, "fingerprintResistance") && !disabled;
  if (fingerprintResistance) {
    const signalMessage: RecordUsageSignalMessage = {
      type: "record-usage-signal",
      signal: "fingerprint",
      hostname: location.hostname,
    };
    browser.runtime.sendMessage(signalMessage).catch(() => {});
  }
  const seedResponse = fingerprintResistance
    ? settings.fingerprintRotatePerSession
      ? // The background worker may still be waking up right after a browser
        // restart -- fall back to the permanent seed rather than fail the
        // whole config message over a message-channel hiccup.
        await fetchFingerprintSeed(true).catch(() => fetchFingerprintSeed(false))
      : await fetchFingerprintSeed(false)
    : undefined;
  const fingerprintSeed = seedResponse?.seed ?? "";
  const blobWorkers = seedResponse?.blobWorkers === true;

  // Each guard gets only what it needs: the popup guard never sees the seed.
  popupGuardPort?.postMessage({ disabled } satisfies PopupGuardConfig);
  fingerprintChannel.port1.postMessage({ fingerprintResistance, fingerprintSeed, blobWorkers } satisfies FingerprintGuardConfig);
}

connectGuards();
void sendConfig();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "managed" || (area === "local" && STORAGE_KEY in changes)) void sendConfig();
});

function forwardGuardReport(event: MessageEvent<GuardBlockReport>): void {
  // A paused page's guard blocks nothing, so a report there isn't real.
  if (pageDisabled) return;
  const report = event.data;
  if (typeof report !== "object" || report === null) return;
  if (report.kind !== "window-open" && report.kind !== "synthetic-click") return;
  const url = typeof report.url === "string" ? report.url : null;
  const message: BlockedMessage = { type: "blocked", kind: report.kind, url };
  browser.runtime.sendMessage(message).catch(() => {
    // Background worker may be restarting; the block already happened
    // client-side, so a missed badge tick isn't worth retrying.
  });
}

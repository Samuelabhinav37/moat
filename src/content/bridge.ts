// Isolated-world content script: the only piece of the content-script pair
// with access to extension APIs. Tells the MAIN-world guards (popup guard,
// fingerprint guard) whether this site is paused and what to do, and
// relays their block reports back to the background worker.
import browser from "webextension-polyfill";
import {
  GUARD_CONNECT_EVENT,
  STORAGE_KEY,
  type BlockedMessage,
  type FingerprintGuardConfig,
  type GuardBlockReport,
  type PopupGuardConfig,
  type FingerprintSeedResponse,
  type GetFingerprintSeedMessage,
  type RecordUsageSignalMessage,
} from "../types";
import { getEffectiveSettings } from "../background/settings";
import { matchesDomainOrSubdomain } from "../shared/domainChain";
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

// One private channel per MAIN-world guard, handed over synchronously below.
const popupGuardChannel = new MessageChannel();
const fingerprintChannel = new MessageChannel();

// This content script runs at document_start, after the MAIN-world guards
// (earlier in the manifest) and before any page script. dispatchEvent is
// synchronous, so the guards take their ports right here, and no page
// script exists yet to see the event or the ports. Ports cross from this
// isolated world into the page's world (checked in Chrome).
function connectGuards(): void {
  document.dispatchEvent(
    new MessageEvent(GUARD_CONNECT_EVENT, { ports: [popupGuardChannel.port2, fingerprintChannel.port2] })
  );
}

async function sendConfig(): Promise<void> {
  const settings = await getEffectiveSettings();
  const disabled = !settings.enabled || matchesDomainOrSubdomain(location.hostname, settings.disabledSites);
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
  popupGuardChannel.port1.postMessage({ disabled } satisfies PopupGuardConfig);
  fingerprintChannel.port1.postMessage({ fingerprintResistance, fingerprintSeed, blobWorkers } satisfies FingerprintGuardConfig);
}

connectGuards();
void sendConfig();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "managed" || (area === "local" && STORAGE_KEY in changes)) void sendConfig();
});

popupGuardChannel.port1.onmessage = (event: MessageEvent<GuardBlockReport>) => {
  const report = event.data;
  if (typeof report !== "object" || report === null) return;
  if (report.kind !== "window-open" && report.kind !== "synthetic-click") return;
  const url = typeof report.url === "string" ? report.url : null;
  const message: BlockedMessage = { type: "blocked", kind: report.kind, url };
  browser.runtime.sendMessage(message).catch(() => {
    // Background worker may be restarting; the block already happened
    // client-side, so a missed badge tick isn't worth retrying.
  });
};

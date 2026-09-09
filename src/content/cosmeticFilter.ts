// Isolated-world content script, top frame only.
//
// The bundled + user cosmetic CSS (the containers a blocked ad or cookie
// notice leaves behind) is built and injected by the SERVICE WORKER as a
// user-origin stylesheet on webNavigation.onCommitted -- see
// background/cosmeticInject.ts. Nothing is fetched, parsed, or styled on the
// page thread here.
//
// This script does two page-thread-only jobs:
//  1. startAdCollapse -- collapse the empty box a network-blocked ad
//     iframe/img leaves behind (needs the live DOM; runs on its own timers).
//  2. the DOM surveyor -- watch which class/id tokens actually appear on the
//     page and ask the worker for the token-anchored generic selectors that
//     match them (get-cosmetic-generics). The worker injects those too, so
//     the surveyor's onNewSelectors callback has nothing to do; its return
//     value is used only for the surveyor's own keep-going bookkeeping.
import browser from "webextension-polyfill";
import { startSurveyor } from "./cosmeticSurveyor";
import { startAdCollapse } from "./adCollapse";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import type { CosmeticGenericsResponse } from "../types";

// The curated ad-network domain list adCollapse.ts uses. Best-effort: an
// empty set just means the collapse pass no-ops.
async function readAdNetworks(): Promise<Set<string>> {
  try {
    const list = (await (await fetch(browser.runtime.getURL("rules/ad-networks.json"))).json()) as unknown;
    return Array.isArray(list) ? new Set(list.filter((d): d is string => typeof d === "string")) : new Set();
  } catch {
    return new Set();
  }
}

async function run(): Promise<void> {
  const effective = await getEffectiveSettingsHere();
  // If protection is paused here the worker's onCommitted handler skips CSS
  // injection too -- keep them consistent by not surveying either.
  if (isDisabled(effective)) return;

  startAdCollapse(window, await readAdNetworks());

  startSurveyor(
    document,
    [],
    (hashes) =>
      browser.runtime
        .sendMessage({ type: "get-cosmetic-generics", hostname: location.hostname, hashes })
        .then((res) => (res as CosmeticGenericsResponse | undefined)?.selectors ?? []),
    () => {
      // The worker injected the matches; nothing to apply page-side.
    }
  );
}

void run();

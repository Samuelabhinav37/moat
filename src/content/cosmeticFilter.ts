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
import { startProceduralCosmetic } from "./proceduralCosmetic";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { customRuleOriginsForHostname, matchingCustomRuleOrigins } from "./cosmeticSelectors";
import type { CosmeticGenericsResponse, ProceduralRulesResponse, RecordCustomRuleMatchMessage, Settings } from "../types";

// Same two-pass timing as adCollapse.ts's own SECOND_PASS_DELAY_MS -- late-
// rendering content (a lazy-loaded section, an SPA route change) can make a
// selector start matching well after document_idle.
const CUSTOM_RULE_CHECK_DELAY_MS = 2500;

/** Checks whether this hostname's own saved element-picker selectors
 * (customCosmeticRules/customGrayscaleRules) actually matched anything in
 * the live DOM, and reports whichever ones did -- background/
 * cosmeticInject.ts injects the corresponding CSS blind, with no feedback
 * of its own on whether a selector found anything. Only ever reports a
 * hostname/selector pair that actually matched this pass; a selector that
 * matched nothing is simply omitted, not reported as a miss. No-ops
 * entirely when this hostname has no custom rules of its own. */
function watchCustomRuleMatches(effective: Settings): void {
  const hideOrigins = customRuleOriginsForHostname(effective.customCosmeticRules, location.hostname);
  const grayscaleOrigins = customRuleOriginsForHostname(effective.customGrayscaleRules, location.hostname);
  if (hideOrigins.length === 0 && grayscaleOrigins.length === 0) return;

  const report = (): void => {
    const hideHits = matchingCustomRuleOrigins(document, hideOrigins);
    const grayscaleHits = matchingCustomRuleOrigins(document, grayscaleOrigins);
    if (hideHits.length === 0 && grayscaleHits.length === 0) return;
    const message: RecordCustomRuleMatchMessage = { type: "record-custom-rule-match", hideHits, grayscaleHits };
    browser.runtime.sendMessage(message).catch(() => {});
  };

  if (document.readyState === "complete") report();
  else window.addEventListener("load", report, { once: true });
  window.setTimeout(report, CUSTOM_RULE_CHECK_DELAY_MS);
}

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
  watchCustomRuleMatches(effective);

  // Procedural (extended-selector) rules -- evaluated against the live DOM
  // here because :has-text/:matches-css/:xpath need it; the worker can't run
  // them. Best-effort: a failed request just means no procedural hiding.
  void browser.runtime
    .sendMessage({ type: "get-procedural-rules", hostname: location.hostname })
    .then((res) => {
      const rules = (res as ProceduralRulesResponse | undefined)?.rules ?? [];
      if (rules.length > 0) startProceduralCosmetic(document, rules);
    })
    .catch(() => {});

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

// Applies the new lookalike sites (see src/shared/liveLookalikes.ts) as one
// dynamic rule that stops their pages, so Moat's block page can warn first.
// Its priority sits below "Never block" and pausing a site, and "Open
// anyway" steps past it. Only while the Phishing list is on, and only on
// Chrome: Firefox has no Moat block page, so it would be a hard block.
import browser from "webextension-polyfill";
import type { DeclarativeNetRequest } from "webextension-polyfill";
import { LIVE_LOOKALIKES_FORMAT, LIVE_LOOKALIKES_KEY, LOOKALIKE_RULE_ID, parseLiveLookalikePayload } from "../shared/liveLookalikes";
import { LOOKALIKE_PRIORITY } from "../shared/rulePriorities";
import { activeGroups } from "./liveSecurityRules";

/** The rule for the stored sites, or none while the Phishing list is off. Pure; exported for tests. */
export function buildLookalikeRules(domains: readonly string[], phishingOn: boolean): DeclarativeNetRequest.Rule[] {
  if (!phishingOn || domains.length === 0) return [];
  return [
    {
      id: LOOKALIKE_RULE_ID,
      priority: LOOKALIKE_PRIORITY,
      action: { type: "block" },
      condition: { requestDomains: [...domains], resourceTypes: ["main_frame"] },
    },
  ];
}

/** Domain to brand, as stored. */
export async function storedLookalikes(): Promise<Record<string, string>> {
  const stored = (await browser.storage.local.get(LIVE_LOOKALIKES_KEY))[LIVE_LOOKALIKES_KEY];
  return parseLiveLookalikePayload({ format: LIVE_LOOKALIKES_FORMAT, domains: stored ?? {} }) ?? {};
}

/** Store a verified payload and apply it. Returns how many sites it holds. */
export async function storeLookalikePayload(value: unknown): Promise<number> {
  const parsed = parseLiveLookalikePayload(value);
  if (!parsed) throw new Error("lookalike-domains payload was malformed");
  // Stored in the payload's own shape so storedLookalikes() checks it again.
  await browser.storage.local.set({ [LIVE_LOOKALIKES_KEY]: Object.fromEntries(Object.entries(parsed).map(([domain, brand]) => [domain, { brand }])) });
  await applyLookalikeRules();
  return Object.keys(parsed).length;
}

/** (Re)apply the stored sites. Called after a fetch and whenever the filter lists change. */
export async function applyLookalikeRules(): Promise<void> {
  const firefox = browser.runtime.getURL("/").startsWith("moz-extension:");
  const domains = firefox ? [] : Object.keys(await storedLookalikes());
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [LOOKALIKE_RULE_ID],
    addRules: buildLookalikeRules(domains, (await activeGroups()).has("phishing-urls")),
  });
}

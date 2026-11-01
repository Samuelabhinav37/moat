// Applies the daily ad domains (see src/shared/liveAds.ts) as dynamic block
// rules shaped like the bundled oisd rules they extend: every request type
// but the page itself, priority 1, so pausing a site or "Never block" still
// wins. Only while the oisd list is on.
import browser from "webextension-polyfill";
import type { DeclarativeNetRequest } from "webextension-polyfill";
import { LIVE_AD_ID_START, MAX_LIVE_AD_RULES, parseLiveAdPayload, LIVE_ADS_FORMAT } from "../shared/liveAds";
import { activeGroups } from "./liveSecurityRules";

export const LIVE_ADS_KEY = "liveAdDomains";
const DOMAINS_PER_RULE = 50_000;
// The bundled oisd rules' types (scripts/lib/oisdRules.mjs).
const RESOURCE_TYPES: DeclarativeNetRequest.ResourceType[] = [
  "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
];

/** Rules for the stored domains, or none while oisd is off. Pure; exported for tests. */
export function buildLiveAdRules(domains: readonly string[], oisdOn: boolean): DeclarativeNetRequest.Rule[] {
  if (!oisdOn) return [];
  const rules: DeclarativeNetRequest.Rule[] = [];
  for (let i = 0; i < domains.length && rules.length < MAX_LIVE_AD_RULES; i += DOMAINS_PER_RULE) {
    rules.push({
      id: LIVE_AD_ID_START + rules.length,
      priority: 1,
      action: { type: "block" },
      condition: { requestDomains: domains.slice(i, i + DOMAINS_PER_RULE), resourceTypes: RESOURCE_TYPES },
    });
  }
  return rules;
}

/** Store a verified payload and apply it. Returns how many domains it holds. */
export async function storeLiveAdPayload(value: unknown): Promise<number> {
  const domains = parseLiveAdPayload(value);
  if (!domains) throw new Error("ad-domains payload was malformed");
  await browser.storage.local.set({ [LIVE_ADS_KEY]: domains });
  await applyLiveAdRules();
  return domains.length;
}

/** (Re)apply the stored domains. Called after a fetch and whenever the filter lists change. */
export async function applyLiveAdRules(): Promise<void> {
  const stored = (await browser.storage.local.get(LIVE_ADS_KEY))[LIVE_ADS_KEY];
  const domains = parseLiveAdPayload({ format: LIVE_ADS_FORMAT, domains: stored ?? [] }) ?? [];
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: Array.from({ length: MAX_LIVE_AD_RULES }, (_, i) => LIVE_AD_ID_START + i),
    addRules: buildLiveAdRules(domains, (await activeGroups()).has("oisd")),
  });
}

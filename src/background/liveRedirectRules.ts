// Pure logic behind the live-updated redirect-domain blocklist (see
// liveUpdates.ts, which fetches the domain list and applies these as
// dynamic declarativeNetRequest rules). Kept separate so it's testable
// without mocking the browser API.
import type { DeclarativeNetRequest } from "webextension-polyfill";

// Dynamic rule ids are a flat namespace shared with anything else that
// might use updateDynamicRules in the future -- start high enough to stay
// out of the way, and cap well under the guaranteed dynamic-rule budget.
export const LIVE_DYNAMIC_RULE_ID_START = 900_000;
export const MAX_LIVE_DYNAMIC_RULES = 2000;

export function buildDynamicRedirectRules(domains: string[]): DeclarativeNetRequest.Rule[] {
  return domains.slice(0, MAX_LIVE_DYNAMIC_RULES).map((domain, index) => ({
    id: LIVE_DYNAMIC_RULE_ID_START + index,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: `||${domain}^`, resourceTypes: ["main_frame"] },
  }));
}

/** Ids of every rule buildDynamicRedirectRules could ever produce, for clearing stale ones before re-adding. */
export function allLiveDynamicRuleIds(): number[] {
  return Array.from({ length: MAX_LIVE_DYNAMIC_RULES }, (_, i) => LIVE_DYNAMIC_RULE_ID_START + i);
}

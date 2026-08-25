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

// Same shape check as customRules.ts's -- kept as its own copy rather than
// a shared import since the two modules have no other coupling and this is
// three lines. `domain` here comes from a remote GitHub-hosted list rather
// than the user's own input, so one malformed upstream entry must not be
// able to throw and silently drop the whole day's refresh.
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Returns the valid domains plus how many entries were rejected, so callers can report it. */
export function filterValidRedirectDomains(domains: string[]): { valid: string[]; rejectedCount: number } {
  const valid = domains.filter((domain) => HOSTNAME_PATTERN.test(domain));
  return { valid, rejectedCount: domains.length - valid.length };
}

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

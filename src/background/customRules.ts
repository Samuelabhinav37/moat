// Pure builders for the user's own custom block/allow rules, applied as
// dynamic declarativeNetRequest rules (see settings.ts, which calls
// applyCustomRules whenever customBlockedDomains/customAllowedDomains
// change). Reserved id ranges keep these from colliding with
// liveRedirectRules.ts's 900_000+ range.
import type { DeclarativeNetRequest } from "webextension-polyfill";

export const CUSTOM_BLOCK_ID_START = 800_000;
export const CUSTOM_ALLOW_ID_START = 810_000;
export const MAX_CUSTOM_RULES_PER_LIST = 1000;

const ALL_RESOURCE_TYPES: DeclarativeNetRequest.ResourceType[] = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other",
];

/** Blocks a whole site outright -- unlike the redirect safety net (main_frame only), this covers every resource type. */
export function buildCustomBlockRules(domains: string[]): DeclarativeNetRequest.Rule[] {
  return domains.slice(0, MAX_CUSTOM_RULES_PER_LIST).map((domain, index) => ({
    id: CUSTOM_BLOCK_ID_START + index,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: `||${domain}^`, resourceTypes: ALL_RESOURCE_TYPES },
  }));
}

/** Exceptions -- unblocks a domain the bundled lists or a custom block rule would otherwise catch. Needs higher priority to win. */
export function buildCustomAllowRules(domains: string[]): DeclarativeNetRequest.Rule[] {
  return domains.slice(0, MAX_CUSTOM_RULES_PER_LIST).map((domain, index) => ({
    id: CUSTOM_ALLOW_ID_START + index,
    priority: 2,
    action: { type: "allow" },
    condition: { urlFilter: `||${domain}^`, resourceTypes: ALL_RESOURCE_TYPES },
  }));
}

export function allCustomBlockRuleIds(): number[] {
  return Array.from({ length: MAX_CUSTOM_RULES_PER_LIST }, (_, i) => CUSTOM_BLOCK_ID_START + i);
}

export function allCustomAllowRuleIds(): number[] {
  return Array.from({ length: MAX_CUSTOM_RULES_PER_LIST }, (_, i) => CUSTOM_ALLOW_ID_START + i);
}

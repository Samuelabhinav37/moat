// Pure builders for the user's own custom block/allow rules, applied as
// dynamic declarativeNetRequest rules (see settings.ts, which calls
// applyCustomRules whenever customBlockedDomains/customAllowedDomains
// change). Reserved id ranges keep these from colliding with
// liveRedirectRules.ts's 900_000+ range.
import type { DeclarativeNetRequest } from "webextension-polyfill";

export const CUSTOM_BLOCK_ID_START = 800_000;
export const CUSTOM_ALLOW_ID_START = 810_000;
export const MAX_CUSTOM_RULES_PER_LIST = 1000;

// Bare hostname only (labels of alphanumerics/hyphens, dot-separated, no
// protocol/path/port) -- `domain` gets interpolated straight into a DNR
// urlFilter below, and updateDynamicRules is one atomic call, so a single
// malformed entry (a stray space, a pasted full URL) must never reach it:
// that would throw and silently drop every other rule in the same batch,
// not just the bad one.
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * ASCII-only after this: an internationalized domain typed as-is (e.g.
 * "münchen.de") would otherwise fail HOSTNAME_PATTERN outright and be
 * silently dropped, even though it's a perfectly real, valid domain --
 * `urlFilter` needs the same punycode form a real request's hostname is
 * always normalized to anyway. `URL`'s own host parser already does this
 * IDNA conversion (plus lowercasing) as a side effect of parsing; building
 * with a throwaway scheme and then checking nothing besides a bare host
 * came along for the ride (a path, port, credentials) keeps this from
 * silently *accepting* more than HOSTNAME_PATTERN already would have --
 * "https://b.com/path" or "example.com:8080" must still be rejected, the
 * same way they always were, not have their extra parts quietly stripped.
 */
function toAsciiHostname(input: string): string | null {
  try {
    const url = new URL(`http://${input}`);
    if (url.pathname !== "/" || url.port || url.username || url.password || url.search || url.hash) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function filterValidDomains(domains: string[]): string[] {
  const valid: string[] = [];
  for (const domain of domains) {
    const ascii = toAsciiHostname(domain);
    if (ascii && HOSTNAME_PATTERN.test(ascii)) valid.push(ascii);
    else console.warn(`Moat: skipping malformed custom-rule domain "${domain}"`);
  }
  return valid;
}

export const ALL_RESOURCE_TYPES: DeclarativeNetRequest.ResourceType[] = [
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
  return filterValidDomains(domains)
    .slice(0, MAX_CUSTOM_RULES_PER_LIST)
    .map((domain, index) => ({
      id: CUSTOM_BLOCK_ID_START + index,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: `||${domain}^`, resourceTypes: ALL_RESOURCE_TYPES },
    }));
}

/** Exceptions -- unblocks a domain the bundled lists or a custom block rule would otherwise catch. Needs higher priority to win. */
export function buildCustomAllowRules(domains: string[]): DeclarativeNetRequest.Rule[] {
  return filterValidDomains(domains)
    .slice(0, MAX_CUSTOM_RULES_PER_LIST)
    .map((domain, index) => ({
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

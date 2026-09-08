// Pure validation for live/cosmetic-fixes.json -- the policy-clean half of the
// live-update channel. Where the redirect-domain list and quick-fixes compile
// to declarativeNetRequest rules (and so live in the grey zone of "remote
// content applied as rules"), a cosmetic fix is just a CSS selector the
// content script hides -- plain *data* the page-side code consumes, exactly
// like the user's own element-picker rules. That makes it the right shape for
// the common breakage-wave scenario (a site changed the markup around its ad
// slot and the bundled selector went stale) without any store-review wait.
//
// Shape: { "<hostname>": ["<selector>", ...] }, consumed via
// cosmeticSelectors.customSelectorsForHostname (same as customCosmeticRules).
// Ships as `{}`.
import { isSafeCosmeticSelector } from "../shared/selectorSafety";

export const MAX_LIVE_COSMETIC_DOMAINS = 500;
export const MAX_LIVE_COSMETIC_SELECTORS_PER_DOMAIN = 50;

// Same host check the redirect-domain list uses (liveRedirectRules.ts). The
// content script walks the registrable-domain chain, so entries are bare
// hostnames, not URL patterns.
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/**
 * Keep only well-formed `{ hostname: [safe selector, ...] }` entries. Selectors
 * run through the same `isSafeCosmeticSelector` sink as the element-picker and
 * settings-import paths -- no `{ } < \``, bounded length -- so a compromised
 * source can't break out of the injected `<style>` block. Caps bound the blast
 * radius of a bad push. Returns the sanitised map plus a rejected-domain count
 * for the status line.
 */
export function filterValidCosmeticFixes(raw: unknown): {
  valid: Record<string, string[]>;
  rejectedDomains: number;
} {
  const valid: Record<string, string[]> = {};
  let rejectedDomains = 0;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid, rejectedDomains };
  }
  for (const [domain, selectors] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(valid).length >= MAX_LIVE_COSMETIC_DOMAINS) break;
    if (!HOSTNAME_PATTERN.test(domain) || !Array.isArray(selectors)) {
      rejectedDomains += 1;
      continue;
    }
    const safe = selectors
      .filter((s): s is string => typeof s === "string" && isSafeCosmeticSelector(s))
      .slice(0, MAX_LIVE_COSMETIC_SELECTORS_PER_DOMAIN);
    if (safe.length > 0) valid[domain.toLowerCase()] = safe;
    else rejectedDomains += 1;
  }
  return { valid, rejectedDomains };
}

/** Total selectors across every domain -- for the status line. */
export function countCosmeticFixSelectors(map: Record<string, string[]>): number {
  return Object.values(map).reduce((n, list) => n + list.length, 0);
}

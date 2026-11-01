// New sites dressed up as a brand (live/lookalike-domains.json): domains
// registered in the last week whose names imitate a bank, shop or sign-in
// page, like "paypal-login-help.com" or "rnicrosoft.com". Written by
// scripts/update-live-lookalikes.mjs from HaGeZi's newly-registered-domain
// list, applied by src/background/liveLookalikeRules.ts as a warning page
// with "Open anyway", not a hard block: a new site that only looks like a
// brand is suspicious, not proven bad. Shared so the publisher and the
// extension apply the same checks. No webextension-polyfill import.
import { cleanSecurityDomains } from "./liveSecurity.ts";

export const LIVE_LOOKALIKES_FORMAT = 1;
export const LIVE_LOOKALIKES_KEY = "liveLookalikes";
export const LOOKALIKE_RULE_ID = 935_000;
/** About 2,000 a week match; a site stays listed for 30 days. */
export const MAX_LOOKALIKES = 20_000;
export const LOOKALIKE_DAYS = 30;
/** A day adding more than this goes to a person instead of publishing. */
export const MAX_LOOKALIKE_DAILY_ADDS = 3_000;

export interface LiveLookalikePayload {
  format: number;
  generated: string;
  /** Domain to the brand it imitates and the day it was first listed. */
  domains: Record<string, { brand: string; added: string }>;
}

const BRAND = /^[A-Za-z0-9][A-Za-z0-9 .&'-]{0,29}$/;

/** Null for anything that isn't a well-formed payload; otherwise domain to
 * brand, cleaned again (the extension doesn't trust the publisher's checks). */
export function parseLiveLookalikePayload(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<LiveLookalikePayload>;
  if (payload.format !== LIVE_LOOKALIKES_FORMAT || typeof payload.domains !== "object" || payload.domains === null) return null;
  const out: Record<string, string> = {};
  const entries = Object.entries(payload.domains);
  const clean = new Set(cleanSecurityDomains(entries.map(([domain]) => domain)));
  for (const [domain, entry] of entries) {
    const brand = (entry as { brand?: unknown } | null)?.brand;
    if (!clean.has(domain) || typeof brand !== "string" || !BRAND.test(brand)) continue;
    out[domain] = brand;
    if (Object.keys(out).length >= MAX_LOOKALIKES) break;
  }
  return out;
}

/** Why a day's list needs a person: a burst of new matches usually means a
 * matcher or upstream change, not a phishing wave. */
export function lookalikeChangeNeedsReview(previous: readonly string[], next: readonly string[]): string | null {
  const before = new Set(previous);
  const added = next.filter((domain) => !before.has(domain)).length;
  return added > MAX_LOOKALIKE_DAILY_ADDS ? `${added} lookalike sites added (limit ${MAX_LOOKALIKE_DAILY_ADDS})` : null;
}

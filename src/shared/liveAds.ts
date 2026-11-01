// Daily ad domains (live/ad-domains.json): domains on today's oisd list that
// the latest release doesn't block yet, so ad blocking keeps up between
// releases the way a router list does. Written by
// scripts/update-live-ads.mjs, applied by src/background/liveAdRules.ts as
// dynamic rules shaped like the bundled oisd ones (every type but the page
// itself), only while the oisd list is on. Shared so the publisher and the
// extension apply the same checks. No webextension-polyfill import.
import { cleanSecurityDomains } from "./liveSecurity.ts";

export const LIVE_ADS_FORMAT = 1;
/** Dynamic rule ids for these, one rule per 50,000 domains. */
export const LIVE_AD_ID_START = 940_000;
export const MAX_LIVE_AD_RULES = 4;
/** oisd adds a few hundred domains a week; releases reset the count. */
export const MAX_LIVE_AD_DOMAINS = 50_000;
/** A day adding more than this goes to a person instead of publishing. */
export const MAX_LIVE_AD_DAILY_ADDS = 5_000;

export interface LiveAdPayload {
  format: number;
  generated: string;
  /** The release the list is a delta against, e.g. "0.11.288". */
  release: string;
  domains: string[];
}

/** Null for anything that isn't a well-formed payload; otherwise its domains,
 * cleaned again (the extension doesn't trust the publisher's checks). */
export function parseLiveAdPayload(value: unknown): string[] | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<LiveAdPayload>;
  if (payload.format !== LIVE_ADS_FORMAT || !Array.isArray(payload.domains)) return null;
  return cleanSecurityDomains(payload.domains).slice(0, MAX_LIVE_AD_DOMAINS);
}

export function isLiveAdRule(rulesetId: string, ruleId: number | undefined): boolean {
  return rulesetId === "_dynamic" && ruleId !== undefined && ruleId >= LIVE_AD_ID_START && ruleId < LIVE_AD_ID_START + MAX_LIVE_AD_RULES;
}

/** Why a day's list needs a person: too many new domains at once usually
 * means a bad upstream list. Shrinking is normal (a release took them in). */
export function adChangeNeedsReview(previous: readonly string[], next: readonly string[]): string | null {
  const before = new Set(previous);
  const added = next.filter((domain) => !before.has(domain)).length;
  return added > MAX_LIVE_AD_DAILY_ADDS ? `${added} domains added (limit ${MAX_LIVE_AD_DAILY_ADDS})` : null;
}

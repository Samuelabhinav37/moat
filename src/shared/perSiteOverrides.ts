import { domainChain } from "./domainChain";
import type { OverridableSettingKey, Settings } from "../types";

export type { OverridableSettingKey };

/** The only settings a per-site override can apply to -- see
 * Settings.perSiteOverrides in types.ts for why this list is narrow: each
 * key here is enforced entirely in a content script that already gates on
 * its own isEnabled() check, so plugging in effectiveValue() there needs no
 * new hostname plumbing. */
export const OVERRIDABLE_KEYS: readonly OverridableSettingKey[] = [
  "fingerprintResistance",
  "cookieBannerAutoReject",
  "aggressiveFeedAdRemoval",
  "hideSeoSpamResults",
];

/**
 * The value a per-site-overridable setting should actually take for
 * hostname: the most specific ancestor domain (hostname itself, then its
 * parent domains) that has an explicit override for key, or the global
 * setting if none do. Same subdomain-inclusive, most-specific-first
 * semantics as customCosmeticRules/disabledSites elsewhere in the codebase.
 */
export function effectiveValue(settings: Settings, hostname: string, key: OverridableSettingKey): boolean {
  for (const domain of domainChain(hostname)) {
    const override = settings.perSiteOverrides[domain]?.[key];
    if (override !== undefined) return override;
  }
  return settings[key];
}

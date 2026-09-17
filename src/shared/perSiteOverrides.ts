import { domainChain, matchesDomainOrSubdomain } from "./domainChain";
import { KNOWN_LOGIN_DOMAIN_DEFAULTS, KNOWN_LOGIN_DOMAINS } from "./knownLoginDomains";
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
 * parent domains) that has an explicit override for key, else this
 * extension's own built-in default for a known login domain (see
 * knownLoginDomains.ts), else the global setting. Same subdomain-inclusive,
 * most-specific-first semantics as customCosmeticRules/disabledSites
 * elsewhere in the codebase.
 */
export function effectiveValue(settings: Settings, hostname: string, key: OverridableSettingKey): boolean {
  for (const domain of domainChain(hostname)) {
    const override = settings.perSiteOverrides[domain]?.[key];
    if (override !== undefined) return override;
  }
  const builtInDefault = KNOWN_LOGIN_DOMAIN_DEFAULTS[key];
  if (builtInDefault !== undefined && matchesDomainOrSubdomain(hostname, KNOWN_LOGIN_DOMAINS)) {
    return builtInDefault;
  }
  return settings[key];
}

import type { OverridableSettingKey } from "../types";

/**
 * Registrable domains of major identity providers, where two of Moat's
 * opt-in protections are more likely to cause real harm than the privacy
 * upside is worth by default:
 *
 * - fingerprintResistance: Google and Facebook both use device-fingerprint
 *   drift as an anti-fraud signal, so spoofing it there tends to trigger a
 *   "verify it's you" / CAPTCHA / new-device challenge rather than protect
 *   anything.
 * - cookieBannerAutoReject: auto-clicking a "reject" button on an identity
 *   provider risks mis-clicking a real security or consent-to-share prompt
 *   instead of an actual cookie banner.
 *
 * These are *defaults* only -- see effectiveValue() in perSiteOverrides.ts,
 * which checks an explicit perSiteOverrides entry for the domain first. A
 * user who wants full protection on one of these sites anyway can still
 * turn it back on there; this only changes what a fresh, never-touched
 * install does under an aggressive preset (Strict turns both of these on
 * globally).
 */
export const KNOWN_LOGIN_DOMAINS: readonly string[] = [
  "google.com",
  "facebook.com",
  "login.microsoftonline.com",
  "live.com",
  "appleid.apple.com",
  "login.yahoo.com",
];

/** Which OVERRIDABLE_KEYS get a built-in default on a known login domain,
 * absent an explicit user override -- see KNOWN_LOGIN_DOMAINS above. Keys
 * not listed here (aggressiveFeedAdRemoval, hideSeoSpamResults) aren't
 * login-flow risks, so they keep following the global setting as usual. */
export const KNOWN_LOGIN_DOMAIN_DEFAULTS: Partial<Record<OverridableSettingKey, boolean>> = {
  fingerprintResistance: false,
  cookieBannerAutoReject: false,
};

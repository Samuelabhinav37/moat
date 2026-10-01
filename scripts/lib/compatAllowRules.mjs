import { QUICK_FIX_PRIORITY } from "../../src/shared/rulePriorities.ts";

// Allow rules for requests that bundled lists block but that sign-in and
// "prove you're human" checks need. Each one was a real breakage:
//
// - Bot-defense sensors (HUMAN/PerimeterX, DataDome, Arkose, ThreatMetrix,
//   GeeTest, AWS WAF): these scripts *are* the check. When the sensor or its
//   collector is blocked, the site never sees a passing score, so it keeps
//   showing "Press & Hold" or a puzzle, or the puzzle never loads. Microsoft
//   sign-up runs HUMAN and Arkose; Zillow runs HUMAN; Reddit runs DataDome.
//   Measured 2026-10-01: Moat blocked client.perimeterx.net (oisd),
//   collector-*.px-client.net / px-cloud.net collectors and js.datadome.co
//   (AdGuard Tracking Protection), h.online-metrix.net (AdGuard + Peter Lowe).
// - CAPTCHA widgets (reCAPTCHA, hCaptcha, Turnstile, Friendly Captcha,
//   MTCaptcha): AdGuard already allows most of these; listed so a future
//   list update can't break them either.
// - Google Sign-In (accounts.google.com/gsi/): AdGuard's Popups filter
//   blocks the whole gsi/client script on a long list of sites (Stack
//   Overflow, Notion, Medium, Perplexity, NYTimes, ...) to hide the One Tap
//   prompt. The same script draws the "Sign in with Google" button, so that
//   button stopped working there.
//
// Kept to vendors whose job is the check itself. Pure fingerprinting or
// fraud-scoring vendors that don't gate a challenge (FingerprintJS, Sift)
// stay blocked.

/** The live quick-fix band: above every bundled ad, tracker and annoyance
 * rule, below "Never block", pause and the security lists, so a phishing or
 * malware block on one of these hosts still wins. */
export const COMPAT_ALLOW_PRIORITY = QUICK_FIX_PRIORITY;

export const COMPAT_ALLOW_URL_FILTERS = [
  // HUMAN (PerimeterX) "Press & Hold" and its collectors.
  "||perimeterx.net^",
  "||px-cloud.net^",
  "||px-client.net^",
  "||px-cdn.net^",
  "||pxchk.net^",
  "||hsprotect.net^",
  // DataDome.
  "||datadome.co^",
  "||captcha-delivery.com^",
  // Arkose Labs (Microsoft, EA, Roblox, ...).
  "||arkoselabs.com^",
  "||funcaptcha.com^",
  // ThreatMetrix: banks and payment sign-ins step up to extra checks without it.
  "||online-metrix.net^",
  // GeeTest, AWS WAF CAPTCHA.
  "||geetest.com^",
  "||awswaf.com^",
  // CAPTCHA widgets.
  "||google.com/recaptcha/",
  "||gstatic.com/recaptcha/",
  "||recaptcha.net^",
  "||hcaptcha.com^",
  "||challenges.cloudflare.com^",
  "||friendlycaptcha.com^",
  "||mtcaptcha.com^",
  // Google Sign-In button and One Tap.
  "||accounts.google.com/gsi/",
];

const RESOURCE_TYPES = [
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other",
];

/** Allow rules, ids from `firstId` up. */
export function buildCompatAllowRules(firstId) {
  return COMPAT_ALLOW_URL_FILTERS.map((urlFilter, i) => ({
    id: firstId + i,
    priority: COMPAT_ALLOW_PRIORITY,
    action: { type: "allow" },
    condition: { urlFilter, resourceTypes: RESOURCE_TYPES },
  }));
}

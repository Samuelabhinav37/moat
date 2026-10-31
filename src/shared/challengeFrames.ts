// The frames bot checks run in (Cloudflare Turnstile, reCAPTCHA, hCaptcha).
// Moat's page-world guards stay out of them: a check that finds built-in
// functions replaced takes it as a bot signal and keeps re-challenging.
// Field report 2026-10-30: Cloudflare checks looped with Moat on. Network
// rules already leave these hosts alone (scripts/lib/compatAllowRules.mjs).

/** Content-script match patterns, for exclude_matches / excludeMatches. */
export const CHALLENGE_FRAME_MATCHES = [
  "*://challenges.cloudflare.com/*",
  "*://www.google.com/recaptcha/*",
  "*://www.recaptcha.net/recaptcha/*",
  "*://*.hcaptcha.com/*",
];

// Pure helper for mainWorldGuard.ts (kept separate so tests can import it
// without that file's import-time window.open patching).
//
// "Sign in with Microsoft/Google/Apple/..." buttons open the identity
// provider in a popup, usually after some async work (MSAL fetches the
// tenant's metadata first) and often from a div-based account tile. The
// popup guard's click heuristics are tuned against popunders, and they
// blocked those popups. A popup whose first URL is a known sign-in page
// is what the user asked for, so it is let through whenever the browser
// itself says the page has a live user gesture.
//
// Payment and bank pages count too (PayPal, Stripe's 3-D Secure, Klarna,
// Plaid...): a checkout's "Pay with" button opens them the same way. Field
// report 2026-10-14: sign-ins to OpenAI, Claude, Notion and apps built on
// WorkOS, Clerk, Firebase and Supabase were blocked, and each blocked or
// unknown one also used up the page's pop-up allowance for the next.

const AUTH_HOSTS = new Set([
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "login.windows.net",
  "account.live.com",
  "accounts.google.com",
  "appleid.apple.com",
  "id.atlassian.com",
  "auth.atlassian.com",
  "login.salesforce.com",
  "discord.com",
  "slack.com",
  "github.com",
  "gitlab.com",
  "www.facebook.com",
  "m.facebook.com",
  "api.twitter.com",
  "twitter.com",
  "x.com",
  "www.linkedin.com",
  "www.paypal.com",
  "www.amazon.com",
  "api.login.yahoo.com",
  "login.yahoo.com",
  "zoom.us",
  "id.twitch.tv",
  "www.dropbox.com",
  "login.okta.com",
  "steamcommunity.com",
  "auth.openai.com",
  "claude.ai",
  "accounts.spotify.com",
  "www.notion.so",
  "api.notion.com",
  "api.workos.com",
  "api.stytch.com",
  "test.stytch.com",
  "api.descope.com",
  // Payments and 3-D Secure.
  "hooks.stripe.com",
  "checkout.stripe.com",
  "pay.google.com",
  "www.sandbox.paypal.com",
]);

// Hosts that serve plenty besides sign-in: only their OAuth paths count.
const AUTH_PATHS: Record<string, RegExp> = {
  "discord.com": /^\/(api\/)?oauth2\//,
  "slack.com": /^\/(openid|oauth)\//,
  "github.com": /^\/login(\/oauth)?\b/,
  "gitlab.com": /^\/oauth\//,
  "www.facebook.com": /^\/(v[\d.]+\/)?dialog\/oauth/,
  "m.facebook.com": /^\/(v[\d.]+\/)?dialog\/oauth/,
  "api.twitter.com": /^\/oauth/,
  "twitter.com": /^\/i\/oauth2\//,
  "x.com": /^\/i\/oauth2\//,
  "www.linkedin.com": /^\/oauth\//,
  "www.paypal.com": /^\/(signin|connect|webapps\/auth|checkoutnow)/,
  "www.amazon.com": /^\/ap\/(oa|signin)/,
  "zoom.us": /^\/oauth\//,
  "www.dropbox.com": /^\/oauth2\//,
  "steamcommunity.com": /^\/openid\//,
  "claude.ai": /^\/(oauth|login)\b/,
  "www.notion.so": /^\/(login|oauth|signup)\b/,
  "api.notion.com": /^\/v1\/oauth\//,
  "api.workos.com": /^\/(user_management|sso)\/authorize/,
  "api.stytch.com": /^\/v1\/public\//,
  "test.stytch.com": /^\/v1\/public\//,
  "api.descope.com": /^\/(oauth2|v1\/auth)\//,
  "www.sandbox.paypal.com": /^\/(signin|connect|webapps\/auth|checkoutnow)/,
};

// Tenant-specific identity hosts (Okta, Auth0, Azure AD B2C, Cognito, Kinde,
// WorkOS AuthKit), and payment and bank hosts (Klarna, Adyen, Braintree, Plaid).
const AUTH_HOST_SUFFIXES = [
  ".okta.com", ".oktapreview.com", ".auth0.com", ".b2clogin.com", ".amazoncognito.com", ".kinde.com", ".authkit.app",
  ".klarna.com", ".adyen.com", ".braintreegateway.com", ".plaid.com",
];

// Sign-in pages on hosts of their own, recognised by host and path:
// WorkOS AuthKit on a custom domain (authkit.cline.bot), Clerk's account
// portal (accounts.openrouter.ai), Supabase, and Firebase's auth handler,
// which every Firebase app serves at /__/auth/ on its own domain.
const AUTH_HOST_PATHS: [RegExp, RegExp][] = [
  [/^authkit\./, /^\/(oauth2|authorize|sign-in|login)\b/],
  [/^accounts\./, /^\/(sign-in|sign-up|oauth)\b/],
  [/\.supabase\.co$/, /^\/auth\/v1\//],
  [/./, /^\/__\/auth\//],
];

/** A standard OAuth or OpenID authorize request, or a SAML one, whoever the
 * provider: an ad pop-up doesn't carry these. */
function isProtocolRequest(url: URL): boolean {
  const q = url.searchParams;
  return (q.has("client_id") && (q.has("response_type") || q.has("redirect_uri"))) || q.has("SAMLRequest");
}

/** What kind of sign-in or payment page `url` (resolved against `base`)
 * opens: "known" for a named provider, which no one else can serve;
 * "pattern" for one recognised only by its shape (an OAuth request, an
 * accounts.* or authkit.* sign-in path, Firebase's /__/auth/), which any
 * site could copy, so it still needs a real click; null for anything else. */
export function authPopupKind(url: string | URL | undefined | null, base: string): "known" | "pattern" | null {
  if (url === undefined || url === null || url === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(String(url), base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  if (AUTH_HOSTS.has(host)) {
    const path = AUTH_PATHS[host];
    return !path || path.test(parsed.pathname) ? "known" : null;
  }
  if (AUTH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return "known";
  if (AUTH_HOST_PATHS.some(([hostPattern, pathPattern]) => hostPattern.test(host) && pathPattern.test(parsed.pathname))) return "pattern";
  return isProtocolRequest(parsed) ? "pattern" : null;
}

/** True when `url` opens a sign-in or payment page of either kind. */
export function isAuthPopupUrl(url: string | URL | undefined | null, base: string): boolean {
  return authPopupKind(url, base) !== null;
}

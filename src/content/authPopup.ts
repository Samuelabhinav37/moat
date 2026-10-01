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
};

// Tenant-specific identity hosts (Okta, Auth0, Azure AD B2C, Cognito).
const AUTH_HOST_SUFFIXES = [".okta.com", ".oktapreview.com", ".auth0.com", ".b2clogin.com", ".amazoncognito.com"];

/** True when `url` (resolved against `base`) opens a known sign-in page. */
export function isAuthPopupUrl(url: string | URL | undefined | null, base: string): boolean {
  if (url === undefined || url === null || url === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(String(url), base);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname;
  if (AUTH_HOSTS.has(host)) {
    const path = AUTH_PATHS[host];
    return path ? path.test(parsed.pathname) : true;
  }
  return AUTH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

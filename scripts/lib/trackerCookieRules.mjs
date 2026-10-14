// Tracker cookies: requests to these domains still load, but without their
// cookies (request `cookie` and response `set-cookie` removed). Privacy
// Badger's "cookieblock" (EFF, GPL-3.0): domains that track across sites
// but that sites need, so blocking them outright breaks pages. This replaces
// flipping Chrome's own "block third-party cookies" setting as Moat's
// default cookie protection: it follows Moat's on/off and pause (a pause's
// allowAllRequests outranks these priority-1 rules), and leaves the rest of
// the web's cookies alone. Field report 2026-10-14: the Chrome-wide switch
// broke sign-ins and stayed on with Moat paused or off.
//
// Two differences from Privacy Badger, both to keep sign-ins and payments
// working, which is the point of this change:
//   - KEEP_COOKIES_HOSTS below are left alone even though Privacy Badger
//     strips them: sign-in providers (an embedded "Sign in with Google"
//     refreshes your session through accounts.google.com), payments (saved
//     cards, fraud checks), bot checks (they carry their pass in a cookie)
//     and documents embedded from Google Drive.
//   - Moat's compat allowances (compatAllowRules.mjs) sit far above
//     priority 1, so they keep their cookies too.
//
// A company's own sites aren't third parties to each other: each rule leaves
// out the owner's other sites (Privacy Badger's multiDomainFirstParties),
// and domainType "thirdParty" leaves out the same site.
import { registrableDomain } from "./publicSuffixList.mjs";
import { entityLookup } from "./privacyBadgerData.mjs";

export const TRACKER_COOKIE_PRIORITY = 1;

const STRIP_COOKIES = {
  type: "modifyHeaders",
  requestHeaders: [{ header: "cookie", operation: "remove" }],
  responseHeaders: [{ header: "set-cookie", operation: "remove" }],
};

// Every type but main_frame: a page you open yourself keeps its cookies.
const RESOURCE_TYPES = [
  "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
];

/** Hosts (and their subdomains) whose cookies stay, though Privacy Badger
 * strips them. Grouped by why. */
export const KEEP_COOKIES_HOSTS = [
  // Sign-in and single sign-on.
  "accounts.google.com", "smartlock.google.com", "apis.google.com",
  "okta.com", "auth0.com", "auth.adobe.com", "auth.privy.io", "auth.openweb.com",
  "id.twitch.tv", "oauth.reddit.com", "accounts.spotify.com", "github.com", "apple.com",
  "login.microsoftonline.com", "login.live.com",
  // Payments and checkout.
  "paypal.com", "paypalobjects.com", "stripe.com", "stripecdn.com", "braintreegateway.com",
  "razorpay.com", "afterpay.com", "quadpay.com", "authorize.net", "pay.google.com",
  "checkout.google.com", "connect.breadpayments.com", "pay.naver.com", "pay.usbank.com",
  "paymentinstruments.mp.microsoft.com", "securepay.constantcontact.com",
  // Bot checks and CAPTCHAs.
  "arkoselabs.com", "captcha-delivery.com", "px-cdn.net", "px-cloud.net", "hcaptcha.com",
  "recaptcha.net", "mtcaptcha.com", "online-metrix.net", "captcha.qcloud.com", "captcha.qq.com",
  "turing.captcha.qcloud.com", "gcaptcha.eo.qcloud.com", "captcha.yandex.net",
  "smartcaptcha.cloud.yandex.ru", "smartcaptcha.yandexcloud.net", "sec-captcha-waf.cdn.bcebos.com",
  // Your own documents embedded in other sites (Notion, Slack, ...).
  "docs.google.com", "drive.google.com", "spreadsheets.google.com", "sites.google.com",
  "script.google.com", "calendar.google.com", "mail.google.com", "lookerstudio.google.com",
  "datastudio.google.com", "groups.google.com",
];

function coveredBy(host, list) {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) if (list.includes(labels.slice(i).join("."))) return true;
  return false;
}

/**
 * @param {object} data Privacy Badger data (privacyBadgerData.mjs): cookieblock and entities.
 * @param {object} psl from loadPsl().
 * @param {number} firstId
 * @returns {{ rules: object[], hosts: string[], keep: string[], entities: string[][] }} the
 *   rules; the hosts they strip, the kept hosts under them, and the company groups they
 *   exclude (for the script-cookie guard, src/content/cookieClobber.ts).
 */
export function buildTrackerCookieRules({ cookieblock, entities }, psl, firstId = 1) {
  const hosts = cookieblock.filter((host) => !coveredBy(host, KEEP_COOKIES_HOSTS)).sort();
  const owners = entityLookup(entities);
  // One rule per owning company that has other sites; everything else shares one rule.
  const byOwner = new Map();
  for (const host of hosts) {
    const site = registrableDomain(host, psl) ?? host;
    const group = owners.get(site);
    const key = group ? group.join(",") : "";
    if (!byOwner.has(key)) byOwner.set(key, { group, hosts: [] });
    byOwner.get(key).hosts.push(host);
  }
  const rules = [...byOwner.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { group, hosts: requestDomains }], i) => {
      const condition = { requestDomains, domainType: "thirdParty", resourceTypes: RESOURCE_TYPES };
      if (group) condition.excludedInitiatorDomains = group;
      // A kept host under a stripped one (a sign-in host under a company
      // domain) keeps its cookies there too.
      const kept = KEEP_COOKIES_HOSTS.filter((keep) => requestDomains.some((d) => keep !== d && keep.endsWith(`.${d}`)));
      if (kept.length) condition.excludedRequestDomains = kept;
      return { id: firstId + i, priority: TRACKER_COOKIE_PRIORITY, action: STRIP_COOKIES, condition };
    });
  const groups = [...byOwner.values()].map(({ group }) => group).filter(Boolean);
  const keep = KEEP_COOKIES_HOSTS.filter((k) => hosts.some((d) => k !== d && k.endsWith(`.${d}`))).sort();
  return { rules, hosts, keep, entities: groups };
}

// The click-tracking hosts email and link services share between all their
// customers. A phishing list sometimes names one of these whole
// (click.pstmrk.it, a.rs6.net) because a phishing email linked through it,
// and then every email from every Postmark or Constant Contact customer hits
// Moat's block page (field report 2026-10-14). A security list may still
// block one sender's own subdomain (u1234.ct.sendgrid.net,
// abcd1234.r.us-east-1.awstrack.me): that's one account. The bad destination
// a shared link leads to is blocked when it loads.
//
// Used by the live security lists (liveSecurity.ts, both when published and
// when applied) and the bundled ones (scripts/update-filters.mjs).

/** Shared hosts, exact. */
const SHARED_HOSTS = new Set([
  // Link shorteners.
  "t.co", "bit.ly", "lnkd.in", "ow.ly", "buff.ly", "tinyurl.com", "rebrand.ly", "goo.gl",
  // Email services' shared click hosts.
  "click.pstmrk.it", "pstmrk.it", "awstrack.me", "sendgrid.net", "ct.sendgrid.net", "ct.eu.sendgrid.net",
  "rs6.net", "a.rs6.net", "r20.rs6.net", "cc.rs6.net", "list-manage.com", "mailchi.mp",
  "mandrillapp.com", "customeriomail.com", "mjt.lu", "sparkpostmail.com", "hubspotlinks.com",
  "hubspotlinksstarter.com", "hubspotlinksfree.com", "klclick.com", "klclick1.com", "klclick2.com",
  "klclick3.com", "click.discord.com", "links.discord.com", "linksynergy.com", "click.linksynergy.com",
  "email.mg.mailgun.net", "cmail19.com", "cmail20.com", "exct.net", "links.iterable.com",
  "safelinks.protection.outlook.com", "urldefense.com", "urldefense.proofpoint.com",
]);

/** Shared hosts by region or shard: r.us-east-1.awstrack.me, us21.list-manage.com,
 * na1.hubspotlinks.com. */
const SHARED_PATTERNS = [
  /^r\.[a-z0-9-]+\.awstrack\.me$/,
  /^us\d+\.list-manage\.com$/,
  /^(?:na|eu|ap)\d+\.hubspotlinks(?:starter|free)?\.com$/,
];

/** True for a host every customer of a link service shares. A "www."
 * prefix and letter case are ignored. */
export function isSharedLinkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return SHARED_HOSTS.has(host) || SHARED_PATTERNS.some((pattern) => pattern.test(host));
}

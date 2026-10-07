// Daily security lists (live/security-domains.json): fresher copies of the
// phishing, malicious-URL and scam domain lists that are also bundled as
// static rulesets. Written by scripts/update-live-security.mjs, applied by
// src/background/liveSecurityRules.ts. Shared so the publisher and the
// extension apply the same checks. No webextension-polyfill import.
//
// The live lists can only add blocks: they become block rules in the
// security band, next to the bundled lists they refresh, and never remove
// or override anything bundled. The guardrails below bound what a bad or
// compromised upstream list could do to "block a site that shouldn't be".

/** Filter groups a live list refreshes, and where each comes from. The
 * bundled rulesets for these groups come from the same upstream lists
 * (AdGuard builds its phishing and malicious-URL filters from
 * malware-filter), so these are the same data, days fresher. */
export const LIVE_SECURITY_SOURCES = {
  "phishing-urls": "https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt",
  "malicious-urls": "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt",
  scam: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/fake-onlydomains.txt",
} as const;

export type LiveSecurityGroup = keyof typeof LIVE_SECURITY_SOURCES;
export const LIVE_SECURITY_GROUPS = Object.keys(LIVE_SECURITY_SOURCES) as LiveSecurityGroup[];

export const LIVE_SECURITY_FORMAT = 1;
/** Far above today's sizes (about 40k phishing, 17k scam, 2k malicious). */
export const MAX_LIVE_SECURITY_DOMAINS_PER_GROUP = 150_000;

/** Sites a security list must never be able to take down, however it's
 * changed. Exact domains and their "www.": a phishing page on a
 * subdomain of one of these (sites.google.com/...) is a URL rule in the
 * bundled lists, not a domain entry. */
export const PROTECTED_DOMAINS: readonly string[] = [
  "google.com", "youtube.com", "gmail.com", "googleapis.com", "gstatic.com",
  "microsoft.com", "live.com", "office.com", "outlook.com", "bing.com", "microsoftonline.com", "windows.net",
  "apple.com", "icloud.com",
  "amazon.com", "amazonaws.com", "cloudfront.net",
  "facebook.com", "instagram.com", "whatsapp.com", "messenger.com",
  "x.com", "twitter.com", "linkedin.com", "reddit.com", "tiktok.com", "pinterest.com",
  "wikipedia.org", "wikimedia.org",
  "github.com", "githubusercontent.com", "gitlab.com",
  "cloudflare.com", "akamaihd.net", "fastly.net",
  "paypal.com", "stripe.com",
  "mozilla.org", "firefox.com", "chromewebstore.google.com",
  "dropbox.com", "zoom.us", "slack.com", "netflix.com", "spotify.com",
  "yahoo.com", "duckduckgo.com", "baidu.com", "yandex.ru",
];
const PROTECTED = new Set(PROTECTED_DOMAINS);

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A host name a security list may block: well formed, not an IP address,
 * not a protected site. (Public suffixes are dropped by the publisher,
 * which has the Public Suffix List.) */
export function isAllowedSecurityHost(domain: string): boolean {
  if (domain.length > 253 || !HOST.test(domain)) return false;
  const bare = domain.startsWith("www.") ? domain.slice(4) : domain;
  return !PROTECTED.has(bare);
}

/** Host names from a hosts-style or plain domain list: one per line,
 * comments and blank lines skipped, "*." prefixes removed (a wildcard entry
 * means the domain and everything under it, which is what a domain rule
 * blocks anyway). */
export function parseDomainList(text: string): string[] {
  const domains: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    domains.push((line.split(/\s+/).pop() ?? "").replace(/^\*\./, ""));
  }
  return domains;
}

/** Lowercased, deduped, sorted, filtered, capped. */
export function cleanSecurityDomains(domains: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const value of domains) {
    if (typeof value !== "string") continue;
    const domain = value.trim().toLowerCase().replace(/\.$/, "");
    if (isAllowedSecurityHost(domain)) out.add(domain);
    if (out.size >= MAX_LIVE_SECURITY_DOMAINS_PER_GROUP) break;
  }
  return [...out].sort();
}

export interface LiveSecurityPayload {
  format: number;
  generated: string;
  groups: Partial<Record<LiveSecurityGroup, string[]>>;
}

/** Null for anything that isn't a well-formed payload; otherwise its groups,
 * each cleaned again (the extension doesn't trust the publisher's checks). */
export function parseLiveSecurityPayload(value: unknown): Partial<Record<LiveSecurityGroup, string[]>> | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<LiveSecurityPayload>;
  if (payload.format !== LIVE_SECURITY_FORMAT || typeof payload.groups !== "object" || payload.groups === null) return null;
  const groups: Partial<Record<LiveSecurityGroup, string[]>> = {};
  for (const group of LIVE_SECURITY_GROUPS) {
    const list = (payload.groups as Record<string, unknown>)[group];
    if (Array.isArray(list)) groups[group] = cleanSecurityDomains(list);
  }
  return groups;
}

/** When a day's change is too big to publish unattended: a list that
 * shrank by more than half (an upstream outage or a truncated download),
 * or more than max(5,000, 25%) domains added or removed. Those go to a
 * pull request for a person to look at instead. */
export function securityChangeNeedsReview(previous: readonly string[], next: readonly string[]): string | null {
  if (previous.length > 0 && next.length < previous.length / 2) {
    return `shrank from ${previous.length} to ${next.length}`;
  }
  const before = new Set(previous);
  const after = new Set(next);
  let added = 0;
  let removed = 0;
  for (const d of after) if (!before.has(d)) added++;
  for (const d of before) if (!after.has(d)) removed++;
  const limit = Math.max(5000, Math.round(previous.length * 0.25));
  if (previous.length > 0 && added + removed > limit) return `${added} added and ${removed} removed (limit ${limit})`;
  return null;
}

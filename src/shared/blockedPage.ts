// Which list stopped a whole page, and what kind of stop it was, for Moat's
// own block page (src/blocked/). Chrome reports a refused page load only as
// net::ERR_BLOCKED_BY_CLIENT; declarativeNetRequest's match feedback names
// the rule, and this turns that rule into a list people can recognise.
// Pure, no webextension-polyfill import, so it's testable and shared by the
// service worker and the page.
import type { RulesetManifestEntry } from "./rulesetManifest";

/** What kind of stop a list makes. Danger lists (phishing, malware, scams)
 * only offer "Open anyway" behind Details, as Chrome's Safe Browsing does.
 * "unknown" is a stop Moat couldn't trace to a list (Chrome's lookup quota
 * was spent): it might be a dangerous site, so it's treated as carefully. */
export type BlockKind = "danger" | "ads" | "custom" | "policy" | "unknown";
export const BLOCK_KINDS: readonly BlockKind[] = ["danger", "ads", "custom", "policy", "unknown"];

/** A list id for rules that aren't from a bundled list. */
export const CUSTOM_LIST = "custom";
export const POLICY_LIST = "policy";
export const UNKNOWN_LIST = "unknown";

// Dynamic rule id ranges (each module's *_ID_START), kept here as plain
// numbers so this file needs nothing from the background.
const RANGES: { start: number; end: number; list: string | "live-security" }[] = [
  { start: 800_000, end: 810_000, list: CUSTOM_LIST }, // customRules.ts CUSTOM_BLOCK_ID_START
  { start: 820_000, end: 830_000, list: POLICY_LIST }, // customRules.ts MANAGED_BLOCK_ID_START
  { start: 930_000, end: 940_000, list: "live-security" }, // liveSecurityRules.ts
  { start: 960_000, end: 970_000, list: POLICY_LIST }, // athenaPolicyRules.ts
];

export interface MatchedRule {
  rulesetId: string;
  ruleId: number;
}

/** The list behind one matched rule. A daily security rule packs a whole
 * list's domains, so `liveGroupFor` looks the site up in those lists. */
export function listForRule(rule: MatchedRule, manifest: readonly RulesetManifestEntry[], liveGroupFor: () => string | null): string {
  if (rule.rulesetId !== "_dynamic" && rule.rulesetId !== "_session") {
    return manifest.find((entry) => entry.id === rule.rulesetId)?.group ?? UNKNOWN_LIST;
  }
  const range = RANGES.find((r) => rule.ruleId >= r.start && rule.ruleId < r.end);
  if (!range) return UNKNOWN_LIST;
  return range.list === "live-security" ? (liveGroupFor() ?? UNKNOWN_LIST) : range.list;
}

/** Danger for the security lists, ads for the rest of Moat's lists. */
export function kindForList(list: string, manifest: readonly RulesetManifestEntry[]): BlockKind {
  if (list === CUSTOM_LIST) return "custom";
  if (list === POLICY_LIST) return "policy";
  return manifest.some((entry) => entry.group === list && entry.category === "security") ? "danger" : "ads";
}

/** The match that stopped the page: the one closest in time to the error.
 * Older matches on the tab (the previous page's ads) are further away. */
export function pageMatch<T extends MatchedRule & { timeStamp: number }>(matches: readonly T[], errorTime: number): T | null {
  let best: T | null = null;
  for (const m of matches) {
    if (!best || Math.abs(m.timeStamp - errorTime) < Math.abs(best.timeStamp - errorTime)) best = m;
  }
  return best;
}

/** The domain or one of its parents is on the list. */
export function hostOnList(hostname: string, domains: ReadonlySet<string>): boolean {
  let host = hostname.toLowerCase();
  for (;;) {
    if (domains.has(host)) return true;
    const dot = host.indexOf(".");
    if (dot === -1) return false;
    host = host.slice(dot + 1);
  }
}

export interface BlockedPageParams {
  url: string;
  list: string;
  kind: BlockKind;
}

/** blocked.html's query string. */
export function blockedPageQuery(params: BlockedPageParams): string {
  return new URLSearchParams({ u: params.url, list: params.list, kind: params.kind }).toString();
}

/** Reads blocked.html's query string, refusing anything odd: the page shows
 * whatever this returns, and anyone can link to an extension page's URL. */
export function parseBlockedPageQuery(search: string): BlockedPageParams | null {
  const q = new URLSearchParams(search);
  const url = q.get("u") ?? "";
  const list = q.get("list") ?? UNKNOWN_LIST;
  const kind = q.get("kind") as BlockKind | null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!kind || !BLOCK_KINDS.includes(kind)) return null;
  if (!/^[a-z0-9-]{1,40}$/.test(list)) return null;
  return { url: parsed.href, list, kind };
}

/** Query keys click-links put their destination under, most specific
 * first. Any other value that is itself a web address counts too. */
const DESTINATION_KEYS = ["url", "u", "murl", "ued", "urllink", "dest", "destination", "redirect", "redirect_url", "target", "to", "goto", "link", "r"];
/** A percent-encoded address in the path, as Amazon SES's awstrack.me
 * puts it: /L0/https:%2F%2Fwise.com%2Fsend/1/... */
const PATH_DESTINATION = /https?(?::|%3A)%2F%2F[^/?#]+/i;

function webAddress(value: string, from: string): string | null {
  let candidate = value.trim();
  if (!/^https?:\/\//i.test(candidate)) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return null;
    }
  }
  if (candidate.length > 2048 || !/^https?:\/\//i.test(candidate)) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  // "https://bank.com@evil.example" reads as bank.com but goes to evil.example.
  if (url.username || url.password) return null;
  if (url.hostname === from || !url.hostname.includes(".")) return null;
  return url.href;
}

/** Where a click-link (an email's "click.brand.com/...?url=...", awin,
 * awstrack.me) was taking you, when the address is in the link itself.
 * Null when it isn't, or when it only points back at the same host. Only
 * ever offered for ad and tracker blocks: a dangerous page's link is not
 * followed, and the destination still goes through Moat's lists. */
export function destinationIn(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const values = [...url.searchParams.entries()];
  const ordered = [
    ...DESTINATION_KEYS.flatMap((key) => values.filter(([k]) => k.toLowerCase() === key).map(([, v]) => v)),
    ...values.filter(([k]) => !DESTINATION_KEYS.includes(k.toLowerCase())).map(([, v]) => v),
  ];
  for (const value of ordered) {
    const found = webAddress(value, url.hostname);
    if (found) return found;
  }
  const inPath = PATH_DESTINATION.exec(url.pathname)?.[0];
  return inPath ? webAddress(inPath, url.hostname) : null;
}

/** rules/security-hosts.json (scripts/lib/securityHosts.mjs): per danger
 * list, the hosts it blocks as whole sites, and the page patterns it
 * blocks on other hosts, each stored as the part after "||host". */
export type SecurityHostsIndex = Record<string, { hosts: string[]; pages: Record<string, string[]> }>;

/** Whether a "||host..." urlFilter matches a page address, the way
 * declarativeNetRequest reads it: "*" is anything, "^" is a separator or
 * the end, a final "|" anchors the end, case doesn't matter. */
export function urlFilterMatches(filter: string, url: string): boolean {
  if (!filter.startsWith("||")) return false;
  let body = filter.slice(2);
  const anchored = body.endsWith("|");
  if (anchored) body = body.slice(0, -1);
  let pattern = "";
  for (const ch of body) {
    if (ch === "*") pattern += ".*";
    else if (ch === "^") pattern += "(?:[^a-z0-9_.%-]|$)";
    else pattern += ch.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
  }
  return new RegExp(`^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?${pattern}${anchored ? "$" : ""}`, "i").test(url);
}

/** The danger list that stops this address, if one that's switched on
 * does: the site as a whole, or this page of it. */
export function securityGroupFor(url: string, index: SecurityHostsIndex, enabled: (group: string) => boolean): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [group, { hosts, pages }] of Object.entries(index)) {
    if (!enabled(group)) continue;
    if (hostOnList(hostname, new Set(hosts))) return group;
    for (let host = hostname; ; host = host.slice(host.indexOf(".") + 1)) {
      if (pages[host]?.some((rest) => urlFilterMatches(`||${host}${rest}`, url))) return group;
      if (!host.includes(".")) break;
    }
  }
  return null;
}

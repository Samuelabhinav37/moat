// Which list stopped a whole page, and what kind of stop it was, for Moat's
// own block page (src/blocked/). Chrome reports a refused page load only as
// net::ERR_BLOCKED_BY_CLIENT; declarativeNetRequest's match feedback names
// the rule, and this turns that rule into a list people can recognise.
// Pure, no webextension-polyfill import, so it's testable and shared by the
// service worker and the page.
import type { RulesetManifestEntry } from "./rulesetManifest";

/** What kind of stop a list makes. Danger lists (phishing, malware, scams)
 * only offer "Open anyway" behind Details, as Chrome's Safe Browsing does. */
export type BlockKind = "danger" | "ads" | "custom" | "policy";
export const BLOCK_KINDS: readonly BlockKind[] = ["danger", "ads", "custom", "policy"];

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

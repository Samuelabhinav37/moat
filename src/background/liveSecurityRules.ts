// Applies the daily security lists (see src/shared/liveSecurity.ts) as
// dynamic block rules, one packed requestDomains rule per list (split at
// DOMAINS_PER_RULE), only for the security lists that are switched on.
// Same shape and priority as the bundled rules they refresh
// (scripts/pack-rules.mjs's output for those lists: every request type
// including page loads, security band priority 55), so a site on both the
// bundled and the live list is blocked the same way, and pausing a site or
// "Never block" still can't unblock a known phishing or malware domain.
import browser from "webextension-polyfill";
import type { DeclarativeNetRequest } from "webextension-polyfill";
import { LIVE_SECURITY_GROUPS, parseLiveSecurityPayload, type LiveSecurityGroup } from "../shared/liveSecurity";
import { SECURITY_PRIORITY_OFFSET } from "../shared/rulePriorities";
import { loadRulesetManifest } from "./rulesetManifestLoader";

export const LIVE_SECURITY_ID_START = 930_000;
export const MAX_LIVE_SECURITY_RULES = 50;
export const LIVE_SECURITY_KEY = "liveSecurityDomains";
/** One rule per list in practice: a domain-list rule has no URL pattern
 * for Chrome to index, so fewer, longer rules cost less per request. */
const DOMAINS_PER_RULE = 50_000;
/** AdGuard's `$all` rules land at 55 inside the security band; so do these. */
export const LIVE_SECURITY_PRIORITY = SECURITY_PRIORITY_OFFSET + 55;
const RESOURCE_TYPES: DeclarativeNetRequest.ResourceType[] = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other",
];

export function allLiveSecurityRuleIds(): number[] {
  return Array.from({ length: MAX_LIVE_SECURITY_RULES }, (_, i) => LIVE_SECURITY_ID_START + i);
}

/** Rules for the switched-on lists. Pure; exported for tests. */
export function buildLiveSecurityRules(
  groups: Partial<Record<LiveSecurityGroup, string[]>>,
  active: ReadonlySet<string>
): DeclarativeNetRequest.Rule[] {
  const rules: DeclarativeNetRequest.Rule[] = [];
  for (const group of LIVE_SECURITY_GROUPS) {
    const domains = groups[group];
    if (!active.has(group) || !domains?.length) continue;
    for (let i = 0; i < domains.length && rules.length < MAX_LIVE_SECURITY_RULES; i += DOMAINS_PER_RULE) {
      rules.push({
        id: LIVE_SECURITY_ID_START + rules.length,
        priority: LIVE_SECURITY_PRIORITY,
        action: { type: "block" },
        condition: { requestDomains: domains.slice(i, i + DOMAINS_PER_RULE), resourceTypes: RESOURCE_TYPES },
      });
    }
  }
  return rules;
}

/** Security lists whose bundled rulesets are on right now (so turning a
 * list off in Settings turns its live refresh off too). */
/** The lists the user has on: every enabled ruleset's group, plus any
 * group filterGroups.ts left out because the browser had no room for its
 * bundled ruleset (Firefox allows 30,000 static rules). The daily lists are
 * dynamic rules, which don't use that budget, so they still apply. */
async function activeGroups(): Promise<Set<string>> {
  const [enabled, manifest, stored] = await Promise.all([
    browser.declarativeNetRequest.getEnabledRulesets(),
    loadRulesetManifest(),
    browser.storage.local.get("filterGroupStatus"),
  ]);
  const on = new Set(enabled);
  const groups = new Set((manifest ?? []).filter((entry) => on.has(entry.id)).map((entry) => entry.group));
  const status = stored.filterGroupStatus as { droppedGroups?: unknown } | undefined;
  if (Array.isArray(status?.droppedGroups)) {
    for (const group of status.droppedGroups) if (typeof group === "string") groups.add(group);
  }
  return groups;
}

/** Store a verified payload and apply it. Returns how many domains it holds. */
export async function storeLiveSecurityPayload(value: unknown): Promise<number> {
  const groups = parseLiveSecurityPayload(value);
  if (!groups) throw new Error("security-domains payload was malformed");
  await browser.storage.local.set({ [LIVE_SECURITY_KEY]: groups });
  await applyLiveSecurityRules();
  return Object.values(groups).reduce((sum, list) => sum + (list?.length ?? 0), 0);
}

/** (Re)apply the stored lists for the lists that are on. Called after a
 * fetch and whenever the filter lists change. */
export async function applyLiveSecurityRules(): Promise<void> {
  const stored = (await browser.storage.local.get(LIVE_SECURITY_KEY))[LIVE_SECURITY_KEY];
  const groups = parseLiveSecurityPayload({ format: 1, generated: "", groups: stored ?? {} }) ?? {};
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: allLiveSecurityRuleIds(),
    addRules: buildLiveSecurityRules(groups, await activeGroups()),
  });
}

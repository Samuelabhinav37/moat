// "Open anyway" on Moat's block page (src/blocked/). One session rule lets
// the site load, at a priority above the security lists and below an
// organization's policy, so a company block still holds. The rule covers
// the site's own requests (its pages, scripts and images) and nothing else,
// so ads and trackers from other domains stay blocked.
//
// It lasts for the visit: when the tab that opened it moves to another site
// or closes, the rule goes. Session rules also end with the browser.
// uBlock Origin's strict-block "Proceed" works the same way. The rule can't
// be limited to the tab with `tabIds`: Chrome files a page load the address
// bar or tabs.update starts under no tab (-1), so the rule would never match
// it. The tab is tracked here instead (storage.session, as the worker can
// stop between events).
//
// The block page can't name a site to allow. It asks to open "this tab's
// blocked page", and the address comes from what the worker itself
// recorded when it sent the tab there.
import browser from "webextension-polyfill";
import type { DeclarativeNetRequest } from "webextension-polyfill";
import { USER_PROCEED_PRIORITY } from "../shared/rulePriorities";
import { ALL_RESOURCE_TYPES } from "./customRules";
import { hostOnList, type BlockKind } from "../shared/blockedPage";
import { hostnameOf } from "../shared/trackerDomains";

export const PROCEED_ID_START = 990_000;
export const MAX_PROCEED_RULES = 100;
const BLOCKED_TABS_KEY = "blockedTabs";
/** Rule id -> the tab that opened it. */
const PROCEED_TABS_KEY = "proceedTabs";

interface BlockedTab {
  url: string;
  kind: BlockKind;
}

/** Remembers which blocked address a tab was sent to the block page for. */
export async function rememberBlockedTab(tabId: number, url: string, kind: BlockKind): Promise<void> {
  const stored = ((await browser.storage.session.get(BLOCKED_TABS_KEY))[BLOCKED_TABS_KEY] ?? {}) as Record<string, BlockedTab>;
  stored[String(tabId)] = { url, kind };
  // A handful of tabs at most; drop the oldest past 50.
  const keys = Object.keys(stored);
  for (const key of keys.slice(0, Math.max(0, keys.length - 50))) delete stored[key];
  await browser.storage.session.set({ [BLOCKED_TABS_KEY]: stored });
}

async function blockedTab(tabId: number): Promise<BlockedTab | null> {
  const stored = ((await browser.storage.session.get(BLOCKED_TABS_KEY))[BLOCKED_TABS_KEY] ?? {}) as Record<string, BlockedTab>;
  return stored[String(tabId)] ?? null;
}

/** The allow rule for one site. Pure; exported for tests. */
export function buildProceedRule(id: number, hostname: string): DeclarativeNetRequest.Rule {
  return {
    id,
    priority: USER_PROCEED_PRIORITY,
    action: { type: "allow" },
    // Without resourceTypes a rule skips main_frame, the page itself.
    condition: { requestDomains: [hostname], resourceTypes: ALL_RESOURCE_TYPES },
  };
}

async function proceedTabs(): Promise<Record<string, number>> {
  return ((await browser.storage.session.get(PROCEED_TABS_KEY))[PROCEED_TABS_KEY] ?? {}) as Record<string, number>;
}

function isProceedRule(rule: DeclarativeNetRequest.Rule): boolean {
  return rule.id >= PROCEED_ID_START && rule.id < PROCEED_ID_START + MAX_PROCEED_RULES;
}

/** The first free id, or null when every slot is taken. */
export function nextProceedId(existing: readonly DeclarativeNetRequest.Rule[]): number | null {
  const used = new Set(existing.filter(isProceedRule).map((rule) => rule.id));
  for (let id = PROCEED_ID_START; id < PROCEED_ID_START + MAX_PROCEED_RULES; id++) if (!used.has(id)) return id;
  return null;
}

/** "Open anyway": allow the tab's blocked site for this visit and load it.
 * Refused for an organization's block, or a tab Moat didn't send to the
 * block page. Returns whether the site is opening. */
export async function openBlockedPage(tabId: number): Promise<boolean> {
  const record = await blockedTab(tabId);
  if (!record || record.kind === "policy") return false;
  const hostname = hostnameOf(record.url);
  if (!hostname) return false;
  const existing = await browser.declarativeNetRequest.getSessionRules();
  const tabs = await proceedTabs();
  // One "Open anyway" per tab: a newer one replaces it.
  const mine = existing.filter((rule) => isProceedRule(rule) && tabs[String(rule.id)] === tabId).map((rule) => rule.id);
  const id = nextProceedId(existing.filter((rule) => !mine.includes(rule.id)));
  if (id === null) return false;
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: mine, addRules: [buildProceedRule(id, hostname)] });
  for (const old of mine) delete tabs[String(old)];
  tabs[String(id)] = tabId;
  await browser.storage.session.set({ [PROCEED_TABS_KEY]: tabs });
  await browser.tabs.update(tabId, { url: record.url });
  return true;
}

/** Ends a tab's "Open anyway" once it moves to a different site (or, with
 * no url, closes). Called for every top-frame commit, so it's cheap when
 * there's nothing to end: getSessionRules has no quota. */
export async function endProceed(tabId: number, url?: string): Promise<void> {
  // The block page itself is a commit too; it isn't "leaving the site".
  if (url?.startsWith(browser.runtime.getURL(""))) return;
  const tabs = await proceedTabs();
  const owned = Object.entries(tabs).filter(([, owner]) => owner === tabId).map(([id]) => Number(id));
  if (!owned.length) return;
  const rules = await browser.declarativeNetRequest.getSessionRules().catch(() => []);
  const host = url ? hostnameOf(url) : "";
  const ended = owned.filter((id) => {
    const rule = rules.find((r) => r.id === id);
    return !rule || !host || !hostOnList(host, new Set(rule.condition.requestDomains ?? []));
  });
  if (!ended.length) return;
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: ended });
  for (const id of ended) delete tabs[String(id)];
  await browser.storage.session.set({ [PROCEED_TABS_KEY]: tabs });
}

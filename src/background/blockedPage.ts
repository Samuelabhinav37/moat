// Moat's own page for a whole site it refused to load. Without it, Chrome
// shows its grey "blocked by an extension" error, which names no list and
// offers no way back. The page says which list stopped the site and why, in
// plain words, with "Go back" first (Chrome Safe Browsing's pattern).
//
// liveBlocks.ts sees the refused page load (net::ERR_BLOCKED_BY_CLIENT on a
// main_frame). One getMatchedRules read names the rule; shared/blockedPage.ts
// turns it into a list. That read shares Chrome's 20-per-10-minutes quota
// with the popup's counts, so it keeps a few calls spare, and without it the
// page still shows, as "one of Moat's lists".
//
// Firefox has no getMatchedRules and reports a refused load differently, so
// it keeps its own error page for now.
import browser from "webextension-polyfill";
import { LIVE_SECURITY_ID_START, LIVE_SECURITY_KEY, MAX_LIVE_SECURITY_RULES } from "./liveSecurityRules";
import type { PageBlocked } from "./liveBlocks";
import { readMatchedRules } from "./matchStats";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import { recordPageStop } from "./usageStats";
import { UNKNOWN_LIST, blockedPageQuery, hostOnList, kindForList, listForRule, pageMatch, type BlockKind, type MatchedRule } from "../shared/blockedPage";
import { hostnameOf } from "../shared/trackerDomains";

/** Leave 2 of Chrome's 20 calls per 10 minutes for opening the popup. */
const MATCHED_RULES_BUDGET = 18;
const MATCH_WAITS_MS = [150, 600];
const MATCH_WINDOW_MS = 1_000;

/** The daily security list a site is on, if any. Read only when a page was
 * stopped by one, which is rare. */
async function liveSecurityGroupFor(hostname: string): Promise<string | null> {
  const stored = (await browser.storage.local.get(LIVE_SECURITY_KEY))[LIVE_SECURITY_KEY] as Record<string, string[]> | undefined;
  for (const [group, domains] of Object.entries(stored ?? {})) {
    if (Array.isArray(domains) && hostOnList(hostname, new Set(domains))) return group;
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The rule that refused the page. Chrome files the match a moment after
 * the error event, so the read waits a little and tries once more if it's
 * not there yet. Only matches from around the error count, so a page
 * stopped a few seconds earlier can't be mistaken for this one. */
async function findPageMatch(block: PageBlocked): Promise<MatchedRule | null> {
  for (const wait of MATCH_WAITS_MS) {
    await sleep(wait);
    const matches = await readMatchedRules(block.tabId, block.timeStamp - MATCH_WINDOW_MS, MATCHED_RULES_BUDGET);
    if (!matches) return null;
    const match = pageMatch(
      matches.filter((m) => Math.abs(m.timeStamp - block.timeStamp) <= MATCH_WINDOW_MS),
      block.timeStamp
    );
    if (match) return match;
  }
  return null;
}

/** Which list stopped the page, and what kind of stop it was. */
export async function resolveBlock(block: PageBlocked): Promise<{ list: string; kind: BlockKind }> {
  const manifest = await loadRulesetManifest().catch(() => []);
  const match = await findPageMatch(block);
  if (!match) return { list: UNKNOWN_LIST, kind: "ads" };
  const live = match.rulesetId === "_dynamic" && match.ruleId >= LIVE_SECURITY_ID_START && match.ruleId < LIVE_SECURITY_ID_START + MAX_LIVE_SECURITY_RULES;
  const liveGroup = live ? await liveSecurityGroupFor(hostnameOf(block.url)) : null;
  const list = listForRule(match, manifest, () => liveGroup);
  // A daily security rule is a danger list even when the site can't be
  // found on one any more (the list updated in between).
  return { list, kind: live ? "danger" : kindForList(list, manifest) };
}

/** Records the stop and shows Moat's page in the tab instead of Chrome's error. */
export async function explainBlockedPage(block: PageBlocked): Promise<void> {
  const hostname = hostnameOf(block.url);
  if (!hostname) return;
  const { list, kind } = await resolveBlock(block);
  await recordPageStop(hostname, { list, kind });
  let tab: browser.Tabs.Tab;
  try {
    tab = await browser.tabs.get(block.tabId);
  } catch {
    return; // Closed in the meantime.
  }
  // Extension pages can't open in an incognito tab (Moat runs "spanning"),
  // and a tab that has moved on to another page keeps it.
  if (tab.incognito) return;
  if (tab.url && tab.url !== block.url && tab.pendingUrl !== block.url) return;
  await browser.tabs.update(block.tabId, { url: browser.runtime.getURL(`blocked.html?${blockedPageQuery({ url: block.url, list, kind })}`) }).catch(() => {});
}

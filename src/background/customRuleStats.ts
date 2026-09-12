// storage.local-only per-rule hit/staleness metadata for the user's own
// element-picker rules (Settings.customCosmeticRules/customGrayscaleRules).
// Kept out of Settings/STORAGE_KEY entirely -- same never-synced posture as
// usageStats.ts -- since neither the settings-export/import format nor the
// storage.sync mirror should carry this device's own local match history.
import browser from "webextension-polyfill";
import { customRuleStatKey, type CustomRuleKind } from "../shared/customRuleStats";
import type { CustomRuleStat, Settings } from "../types";

const CUSTOM_RULE_STATS_KEY = "customRuleStats";

type CustomRuleStatsState = Record<string, CustomRuleStat>;

async function readState(): Promise<CustomRuleStatsState> {
  const stored = await browser.storage.local.get(CUSTOM_RULE_STATS_KEY);
  return (stored[CUSTOM_RULE_STATS_KEY] as CustomRuleStatsState | undefined) ?? {};
}

// Same single-file-queue reasoning as settings.ts's `pending` -- a rule
// removed while a match-report from an earlier page load is still in
// flight must not have the match report's write resurrect it out of order.
let pending: Promise<unknown> = Promise.resolve();

function mutate(updater: (current: CustomRuleStatsState) => CustomRuleStatsState): Promise<void> {
  const result = pending.then(async () => {
    const current = await readState();
    const next = updater(current);
    if (next !== current) await browser.storage.local.set({ [CUSTOM_RULE_STATS_KEY]: next });
  });
  pending = result.catch(() => {});
  return result;
}

/** Idempotent: re-adding a rule that already has stats (e.g. removed and
 * re-picked with the exact same selector) keeps its existing history rather
 * than resetting createdAt. */
export function recordRuleCreated(kind: CustomRuleKind, hostname: string, selector: string): Promise<void> {
  return mutate((current) => {
    const key = customRuleStatKey(kind, hostname, selector);
    if (key in current) return current;
    return { ...current, [key]: { hitCount: 0, lastMatchedAt: null, createdAt: Date.now() } };
  });
}

export function recordRuleRemoved(kind: CustomRuleKind, hostname: string, selector: string): Promise<void> {
  return mutate((current) => {
    const key = customRuleStatKey(kind, hostname, selector);
    if (!(key in current)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });
}

/** hideHits/grayscaleHits name only the selectors that actually matched
 * something in the live DOM this pass -- see content/cosmeticFilter.ts. A
 * selector that matched nothing is simply absent, not reported as a miss. */
export function recordRuleMatches(
  hideHits: Array<{ hostname: string; selector: string }>,
  grayscaleHits: Array<{ hostname: string; selector: string }>
): Promise<void> {
  if (hideHits.length === 0 && grayscaleHits.length === 0) return Promise.resolve();
  return mutate((current) => {
    const next = { ...current };
    const now = Date.now();
    const bump = (kind: CustomRuleKind, hits: Array<{ hostname: string; selector: string }>): void => {
      for (const { hostname, selector } of hits) {
        const key = customRuleStatKey(kind, hostname, selector);
        const existing = next[key];
        next[key] = existing
          ? { ...existing, hitCount: existing.hitCount + 1, lastMatchedAt: now }
          : { hitCount: 1, lastMatchedAt: now, createdAt: now };
      }
    };
    bump("hide", hideHits);
    bump("gray", grayscaleHits);
    return next;
  });
}

export async function getCustomRuleStats(): Promise<CustomRuleStatsState> {
  return readState();
}

/** Sweeps entries whose underlying rule no longer exists in Settings --
 * covers paths that bypass the explicit add/remove wrappers (a settings
 * import, a managed-policy change wiping customCosmeticRules). Safe to call
 * often; a no-op once nothing's orphaned. */
export async function reconcileCustomRuleStats(settings: Settings): Promise<void> {
  const live = new Set<string>();
  for (const [hostname, selectors] of Object.entries(settings.customCosmeticRules)) {
    for (const selector of selectors) live.add(customRuleStatKey("hide", hostname, selector));
  }
  for (const [hostname, selectors] of Object.entries(settings.customGrayscaleRules)) {
    for (const selector of selectors) live.add(customRuleStatKey("gray", hostname, selector));
  }
  await mutate((current) => {
    const keys = Object.keys(current);
    const orphaned = keys.filter((key) => !live.has(key));
    if (orphaned.length === 0) return current;
    const next = { ...current };
    for (const key of orphaned) delete next[key];
    return next;
  });
}

// Pure logic behind the "quick fixes" emergency channel (see liveUpdates.ts,
// which fetches live/quick-fixes.json alongside the redirect-domain list and
// applies these as dynamic declarativeNetRequest rules on the same daily
// alarm). AdGuard ships an equivalent "Quick Fixes filter" for the same
// reason: an anti-adblock circumvention script or a filter-breakage report
// shouldn't have to wait on a full store review cycle to get patched, when
// the fix is small and well-scoped. Kept separate from liveRedirectRules.ts
// (a different, narrower rule shape) and pure/testable without mocking the
// browser API, same as it.
//
// Deliberately NOT a general-purpose remote rule channel: entries can only
// block, allow, or strip query params -- never `action.redirect.url` or
// `regexSubstitution` to an arbitrary target. live/quick-fixes.json is
// fetched over plain HTTPS with no additional signature pinning (same trust
// model as the redirect-domain list -- GitHub account security plus TLS),
// so a rule shape that could redirect traffic to attacker-controlled
// infrastructure is not a risk worth taking for what this channel is for.
import type { DeclarativeNetRequest } from "webextension-polyfill";
import { ALL_RESOURCE_TYPES } from "./customRules";

export const QUICK_FIX_ID_START = 950_000;
export const MAX_QUICK_FIX_RULES = 500;

const VALID_RESOURCE_TYPES = new Set<string>(ALL_RESOURCE_TYPES);

interface QuickFixBase {
  urlFilter: string;
  resourceTypes: DeclarativeNetRequest.ResourceType[];
}
export type QuickFixEntry =
  | (QuickFixBase & { action: "block" })
  | (QuickFixBase & { action: "allow" })
  | (QuickFixBase & { action: "stripParams"; removeParams: string[] });

function hasValidBase(e: Record<string, unknown>): e is Record<string, unknown> & QuickFixBase {
  if (typeof e.urlFilter !== "string" || e.urlFilter.length === 0) return false;
  if (!Array.isArray(e.resourceTypes) || e.resourceTypes.length === 0) return false;
  return e.resourceTypes.every((t) => typeof t === "string" && VALID_RESOURCE_TYPES.has(t));
}

function isValidEntry(entry: unknown): entry is QuickFixEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  if (!hasValidBase(e)) return false;
  if (e.action === "block" || e.action === "allow") return true;
  if (e.action === "stripParams") {
    return Array.isArray(e.removeParams) && e.removeParams.length > 0 && e.removeParams.every((p) => typeof p === "string" && p.length > 0);
  }
  return false;
}

/** Returns the valid entries plus how many were rejected, so callers can report/log it -- same
 * pattern as filterValidRedirectDomains, since this list is remote (GitHub-hosted) content too. */
export function filterValidQuickFixes(entries: unknown[]): { valid: QuickFixEntry[]; rejectedCount: number } {
  const valid = entries.filter(isValidEntry);
  return { valid, rejectedCount: entries.length - valid.length };
}

function buildAction(entry: QuickFixEntry): DeclarativeNetRequest.RuleActionType {
  if (entry.action === "block") return { type: "block" };
  if (entry.action === "allow") return { type: "allow" };
  return {
    type: "redirect",
    redirect: { transform: { queryTransform: { removeParams: entry.removeParams } } },
  };
}

export function buildQuickFixRules(entries: QuickFixEntry[]): DeclarativeNetRequest.Rule[] {
  return entries.slice(0, MAX_QUICK_FIX_RULES).map((entry, index) => ({
    id: QUICK_FIX_ID_START + index,
    priority: 1,
    action: buildAction(entry),
    condition: { urlFilter: entry.urlFilter, resourceTypes: entry.resourceTypes },
  }));
}

/** Ids of every rule buildQuickFixRules could ever produce, for clearing stale ones before re-adding. */
export function allQuickFixRuleIds(): number[] {
  return Array.from({ length: MAX_QUICK_FIX_RULES }, (_, i) => QUICK_FIX_ID_START + i);
}

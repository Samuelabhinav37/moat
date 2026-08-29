// Resolves a matched security-list rule's {rulesetId, ruleId} to the actual
// domain it targeted -- for Athena security events specifically (see
// athenaIntegration.ts). Only ever called for security-classified matches
// under an active Athena connection (see the call site in matchStats.ts),
// the rare-and-gated case, so the cost of fetching and indexing a
// multi-megabyte ruleset file is bounded to when it's actually needed, not
// paid by every normal install or even every security-list hit.
//
// Deliberately resolves and discloses the domain here -- a more permissive
// call than this project's original design (keeping rulesetId/ruleId
// opaque). Revisited during a systems audit: the domain itself is never
// new information -- it's already public, sitting in Moat's own openly-
// published AdGuard-sourced filter lists -- and this path only ever runs
// under enterprise-managed, consented monitoring (see
// athenaIntegration.ts's isAthenaConfigured gate), never a default consumer
// behavior. Keeping it opaque was withholding something Athena could
// trivially look up on its own, while silently preventing the one thing an
// Athena-connected deployment most wants: correlating "Moat blocked this
// domain" against what Clutter independently saw for the same domain.
import browser from "webextension-polyfill";
import { loadRulesetManifest } from "./rulesetManifestLoader";

interface DnrRuleCondition {
  urlFilter?: string;
  requestDomains?: string[];
}
interface DnrRule {
  id: number;
  condition?: DnrRuleCondition;
}

// One parsed {ruleId -> domain} index per ruleset file, built once and
// reused -- rebuilding this on every lookup would mean re-fetching and
// re-parsing a multi-megabyte JSON file per matched rule. Module-level, so
// it's gone on the next service-worker cold start, same lifetime as every
// other in-memory cache in this codebase (loadCompanies() in
// matchStats.ts, the ruleset manifest loader).
const domainIndexCache = new Map<string, Map<number, string>>();

// AdGuard's compiled rules are ~82% plain `||domain^`-anchored blocks (see
// docs/research/dnr-rule-consolidation-audit.md) -- this only needs to
// parse that shape, plus the rarer `requestDomains` condition; a
// regexFilter-based rule (about 6 across the whole bundle) has no
// domain-shaped condition at all and correctly resolves to null below.
function extractDomain(rule: DnrRule): string | null {
  const requestDomain = rule.condition?.requestDomains?.[0];
  if (requestDomain) return requestDomain.toLowerCase();

  const urlFilter = rule.condition?.urlFilter;
  if (!urlFilter) return null;
  const withoutAnchor = urlFilter.startsWith("||") ? urlFilter.slice(2) : urlFilter;
  const match = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i.exec(withoutAnchor);
  return match?.[1] ? match[1].toLowerCase() : null;
}

async function loadDomainIndex(fileName: string): Promise<Map<number, string>> {
  const cached = domainIndexCache.get(fileName);
  if (cached) return cached;
  const url = browser.runtime.getURL(`rules/${fileName}`);
  const rules = (await (await fetch(url)).json()) as DnrRule[];
  const index = new Map<number, string>();
  for (const rule of rules) {
    const domain = extractDomain(rule);
    if (domain) index.set(rule.id, domain);
  }
  domainIndexCache.set(fileName, index);
  return index;
}

/** Best-effort -- resolves to null (never throws) rather than let a
 * malformed/unreachable ruleset fetch break the event this is attached to.
 * Callers should queue the event either way, with or without a domain. */
export async function resolveSecurityRuleDomain(rulesetId: string, ruleId: number | undefined): Promise<string | null> {
  if (ruleId === undefined) return null;
  try {
    const manifest = await loadRulesetManifest();
    const entry = manifest.find((e) => e.id === rulesetId);
    if (!entry) return null;
    const index = await loadDomainIndex(entry.file);
    return index.get(ruleId) ?? null;
  } catch {
    return null;
  }
}

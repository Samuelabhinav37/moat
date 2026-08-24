// Pulled out of cosmeticFilter.ts (which fetches and touches the DOM as
// soon as it's imported) so this logic is importable in tests without a
// browser environment.
import { domainChain } from "../shared/domainChain";
import { bucketForDomain } from "../shared/domainBucket";

export interface CosmeticIndex {
  generic: string[];
  perDomain: Record<string, string[]>;
  exceptions: Record<string, string[]>;
}

export interface CosmeticManifest {
  meta: string;
  bucketCount: number;
}

/**
 * Which of the (up to bucketCount) per-domain shard files could possibly
 * contain a rule for hostname -- one per level of its domain chain, deduped
 * (a hostname and its parent domain can hash to the same bucket). Lets the
 * content script fetch only a handful of small shard files instead of every
 * domain's rules on every page load.
 */
export function shardIndicesForHostname(hostname: string, bucketCount: number): number[] {
  const indices = new Set(domainChain(hostname).map((domain) => bucketForDomain(domain, bucketCount)));
  return [...indices];
}

/** perDomain is sharded across multiple files to stay under Firefox's per-file lint size limit. */
export function mergeDomainShards(shards: Record<string, string[]>[]): Record<string, string[]> {
  return Object.assign({}, ...shards);
}

function excludedForChain(index: CosmeticIndex, chain: string[]): Set<string> {
  const excluded = new Set<string>();
  for (const domain of chain) {
    for (const selector of index.exceptions[domain] ?? []) excluded.add(selector);
  }
  return excluded;
}

/** The generic (no-hostname) slice alone, minus exceptions -- split out from
 * domainSelectorsForHostname so cosmeticFilter.ts can inject the two into
 * separate <style> blocks: generic selectors are the ones eligible for the
 * document_idle unmatched-selector trim (see selectorsStillMatching below),
 * per-domain selectors never are. */
export function genericSelectorsForHostname(index: CosmeticIndex, hostname: string): string[] {
  const excluded = excludedForChain(index, domainChain(hostname));
  return index.generic.filter((selector) => !excluded.has(selector));
}

/** The per-domain slice alone, minus exceptions. See genericSelectorsForHostname. */
export function domainSelectorsForHostname(index: CosmeticIndex, hostname: string): string[] {
  const chain = domainChain(hostname);
  const matched = new Set<string>();
  for (const domain of chain) {
    for (const selector of index.perDomain[domain] ?? []) matched.add(selector);
  }
  const excluded = excludedForChain(index, chain);
  return [...matched].filter((selector) => !excluded.has(selector));
}

/** Selectors that should be hidden on hostname: generic + domain-scoped, minus exceptions. */
export function selectorsForHostname(index: CosmeticIndex, hostname: string): string[] {
  return [...new Set([...genericSelectorsForHostname(index, hostname), ...domainSelectorsForHostname(index, hostname)])];
}

/**
 * Which of `selectors` still match at least one element in `doc`. Used for
 * a one-time document_idle cleanup pass over the generic selector block
 * only (see cosmeticFilter.ts) -- a style-engine cleanup, not a network
 * optimization, since the full generic set is still fetched and injected
 * upfront exactly as before. Fails safe (keeps the selector) on anything
 * that throws rather than risk silently un-hiding something real; build
 * time already validates every selector against jsdom, so a throw here
 * would mean a runtime CSS-engine difference, not a genuinely bad rule.
 */
export function selectorsStillMatching(doc: Pick<Document, "querySelector">, selectors: string[]): string[] {
  return selectors.filter((selector) => {
    try {
      return doc.querySelector(selector) !== null;
    } catch {
      return true;
    }
  });
}

/** Selectors the user picked themselves (element picker), matched the same same-or-subdomain way as the bundled lists. */
export function customSelectorsForHostname(
  customCosmeticRules: Record<string, string[]>,
  hostname: string
): string[] {
  const selectors = new Set<string>();
  for (const domain of domainChain(hostname)) {
    for (const selector of customCosmeticRules[domain] ?? []) selectors.add(selector);
  }
  return [...selectors];
}

const SELECTORS_PER_RULE = 2000;

/** Batches selectors into multiple `{display:none!important}` rules rather than one huge selector list. */
export function buildStyleText(selectors: string[]): string {
  const rules: string[] = [];
  for (let i = 0; i < selectors.length; i += SELECTORS_PER_RULE) {
    rules.push(`${selectors.slice(i, i + SELECTORS_PER_RULE).join(",")}{display:none!important}`);
  }
  return rules.join("\n");
}

/** Same batching as buildStyleText, but for the picker's "Gray out" mode --
 * tones an element down instead of removing it from the page entirely. */
export function buildGrayscaleStyleText(selectors: string[]): string {
  const rules: string[] = [];
  for (let i = 0; i < selectors.length; i += SELECTORS_PER_RULE) {
    rules.push(`${selectors.slice(i, i + SELECTORS_PER_RULE).join(",")}{filter:grayscale(1)!important}`);
  }
  return rules.join("\n");
}

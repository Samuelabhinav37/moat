// Pulled out of cosmeticFilter.ts (which fetches and touches the DOM as
// soon as it's imported) so this logic is importable in tests without a
// browser environment.
import { domainChain } from "../shared/domainChain";

export interface CosmeticIndex {
  generic: string[];
  perDomain: Record<string, string[]>;
  exceptions: Record<string, string[]>;
}

export interface CosmeticManifest {
  meta: string;
  domainShards: string[];
}

/** perDomain is sharded across multiple files to stay under Firefox's per-file lint size limit. */
export function mergeDomainShards(shards: Record<string, string[]>[]): Record<string, string[]> {
  return Object.assign({}, ...shards);
}

/** Selectors that should be hidden on hostname: generic + domain-scoped, minus exceptions. */
export function selectorsForHostname(index: CosmeticIndex, hostname: string): string[] {
  const chain = domainChain(hostname);
  const matched = new Set(index.generic);
  for (const domain of chain) {
    for (const selector of index.perDomain[domain] ?? []) matched.add(selector);
  }

  const excluded = new Set<string>();
  for (const domain of chain) {
    for (const selector of index.exceptions[domain] ?? []) excluded.add(selector);
  }

  return [...matched].filter((selector) => !excluded.has(selector));
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

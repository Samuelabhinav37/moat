// Service-worker owner of the bundled cosmetic dataset.
//
// content/cosmeticFilter.ts used to fetch and JSON.parse rules/cosmetics-meta.json
// (~684 KB) plus 1-3 rules/cosmetics-bucket-N.json shards (~110 KB each) on the
// PAGE main thread at document_start, every top-frame navigation. This module
// moves that work here: the meta file and each bucket are fetched and parsed
// once, kept in memory for the life of the worker, and re-parsed lazily after a
// cold start. The content script now just asks for the slice that applies to
// its hostname (get-cosmetic-slice) and, as the DOM surveyor turns up new
// class/id tokens, for the generic selectors filed under them
// (get-cosmetic-generics).
//
// No cache invalidation: this data only changes when the extension itself is
// updated, which is a fresh worker anyway.
import browser from "webextension-polyfill";
import {
  domainInjectionRulesForHostname,
  domainSelectorsForHostname,
  genericInjectionRulesForHostname,
  genericSelectorsForHostname,
  genericSelectorsForTokens,
  mergeDomainShards,
  shardIndicesForHostname,
  splitDomainShards,
  type CosmeticIndex,
  type CosmeticManifest,
  type DomainShardEntry,
} from "../content/cosmeticSelectors";
import type { CosmeticGenericsResponse, CosmeticSliceResponse } from "../types";

interface CosmeticMeta {
  genericByHash: Record<string, string[]>;
  genericHigh: string[];
  exceptions: Record<string, string[]>;
  injectGeneric?: Array<[selector: string, declaration: string]>;
}

// Guards get-cosmetic-generics: the surveyor batches, but a pathological
// mutation flood shouldn't be able to hand us an unbounded array.
export const MAX_TOKEN_HASHES = 4096;

async function fetchJson<T>(path: string): Promise<T> {
  return (await (await fetch(browser.runtime.getURL(path))).json()) as T;
}

let manifestPromise: Promise<CosmeticManifest> | undefined;
let metaPromise: Promise<CosmeticMeta> | undefined;
const bucketPromises = new Map<number, Promise<Record<string, DomainShardEntry>>>();

function loadManifest(): Promise<CosmeticManifest> {
  return (manifestPromise ??= fetchJson<CosmeticManifest>("rules/cosmetics-manifest.json").catch((err: unknown) => {
    manifestPromise = undefined;
    throw err;
  }));
}

function loadMeta(): Promise<CosmeticMeta> {
  return (metaPromise ??= (async () => {
    const manifest = await loadManifest();
    return fetchJson<CosmeticMeta>(`rules/${manifest.meta}`);
  })().catch((err: unknown) => {
    metaPromise = undefined;
    throw err;
  }));
}

function loadBucket(index: number): Promise<Record<string, DomainShardEntry>> {
  let promise = bucketPromises.get(index);
  if (!promise) {
    promise = fetchJson<Record<string, DomainShardEntry>>(`rules/cosmetics-bucket-${index}.json`).catch((err: unknown) => {
      bucketPromises.delete(index);
      throw err;
    });
    bucketPromises.set(index, promise);
  }
  return promise;
}

/** meta + the (up to a handful of) domain-bucket shards that could carry a
 * rule for `hostname`, assembled into the CosmeticIndex the pure
 * cosmeticSelectors.ts functions expect. */
async function indexForHostname(hostname: string): Promise<CosmeticIndex> {
  const manifest = await loadManifest();
  const wantedBuckets = shardIndicesForHostname(hostname, manifest.bucketCount);
  const [meta, ...shards] = await Promise.all([loadMeta(), ...wantedBuckets.map(loadBucket)]);
  const { perDomain, injectPerDomain } = splitDomainShards(mergeDomainShards(shards));
  return {
    genericByHash: meta.genericByHash,
    genericHigh: meta.genericHigh,
    exceptions: meta.exceptions,
    injectGeneric: meta.injectGeneric,
    perDomain,
    injectPerDomain,
  };
}

/** Everything content/cosmeticFilter.ts needs to inject up front for one
 * hostname, straight from the bundled lists (its own custom / picker /
 * live-fix selectors are merged page-side). */
export async function cosmeticSliceFor(hostname: string): Promise<CosmeticSliceResponse> {
  const index = await indexForHostname(hostname);
  return {
    domainSelectors: domainSelectorsForHostname(index, hostname),
    injectRules: [
      ...genericInjectionRulesForHostname(index, hostname),
      ...domainInjectionRulesForHostname(index, hostname),
    ],
    genericHigh: genericSelectorsForHostname(index, hostname),
    hasTokenIndex: Object.keys(index.genericByHash).length > 0,
  };
}

/** The bundled generic selectors filed under any of `hashes` (class/id token
 * hashes the surveyor found in the DOM), minus this hostname's exceptions.
 * Needs the meta file only, never the domain buckets. */
export async function cosmeticGenericsFor(hostname: string, hashes: string[]): Promise<CosmeticGenericsResponse> {
  const meta = await loadMeta();
  const index: CosmeticIndex = {
    genericByHash: meta.genericByHash,
    genericHigh: meta.genericHigh,
    exceptions: meta.exceptions,
    perDomain: {},
  };
  return { selectors: genericSelectorsForTokens(index, hostname, hashes.slice(0, MAX_TOKEN_HASHES)) };
}

/**
 * Deterministic FNV-1a hash, used to bucket cosmetic per-domain rules into
 * shard files at build time (scripts/lib/domainBucket.mjs) so the content
 * script only has to fetch the handful of buckets its own domain chain
 * hashes into, instead of every domain's rules on every page load. Build
 * time and runtime never talk to each other, so both sides must compute
 * the exact same bucket for the same domain -- scripts/lib/domainBucket.mjs
 * keeps an identical copy of this function, cross-checked by
 * scripts/lib/domainBucket.test.mjs.
 */
export function bucketForDomain(domain: string, bucketCount: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < domain.length; i += 1) {
    hash ^= domain.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % bucketCount;
}

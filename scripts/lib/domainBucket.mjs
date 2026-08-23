// Kept byte-for-byte identical to src/shared/domainBucket.ts's algorithm --
// this is the build-time half of the same deterministic hash, used to
// assign each domain's cosmetic rules to a shard file. The two copies exist
// because scripts/ runs as plain Node ESM and src/ is bundled TypeScript;
// scripts/lib/domainBucket.test.mjs cross-checks they agree.
export function bucketForDomain(domain, bucketCount) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < domain.length; i += 1) {
    hash ^= domain.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % bucketCount;
}

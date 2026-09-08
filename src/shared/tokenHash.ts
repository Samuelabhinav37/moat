/**
 * Deterministic FNV-1a hash of a single class/id token.
 *
 * Used to index the generic (no-hostname) cosmetic-filter selectors by their
 * anchoring class/id token, so the runtime surveyor
 * (src/content/cosmeticSurveyor.ts) only injects the generic selectors whose
 * anchor token actually appears in the page's DOM instead of the whole
 * ~17k-selector set. Build time (scripts/lib/genericTokenIndex.mjs files
 * each selector under its anchor token's hash) and runtime (the surveyor
 * hashes the class/id tokens it finds) never talk to each other, so both
 * sides must compute the exact same value for the same token --
 * scripts/lib/tokenHash.mjs keeps a byte-identical copy of this function,
 * cross-checked by scripts/lib/tokenHash.test.mjs. Same reasoning, and the
 * same FNV-1a core, as src/shared/domainBucket.ts.
 *
 * Returned as an unsigned base-36 string so it's a compact JSON object key
 * in rules/dnr/cosmetics-meta.json.
 */
export function tokenHash(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

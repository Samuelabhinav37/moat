// Kept byte-for-byte identical to src/shared/tokenHash.ts's algorithm -- this
// is the build-time half of the same deterministic hash, used to file each
// generic cosmetic selector under its anchoring class/id token's hash. The
// two copies exist because scripts/ runs as plain Node ESM and src/ is
// bundled TypeScript; scripts/lib/tokenHash.test.mjs cross-checks they agree.
export function tokenHash(token) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

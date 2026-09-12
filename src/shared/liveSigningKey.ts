// Ed25519 public key that signs live/manifest.json, as raw base64 (44 chars).
// Empty string = signing not configured yet -> the live-update channel runs
// hash-only, exactly as before. Fill this in with the output of
// `node scripts/gen-live-signing-key.mjs` (step 2 in that file's header), then
// re-run `npm run filters:update` with LIVE_SIGNING_PRIVATE_KEY set so a
// live/manifest.json.sig is produced.
//
// Rotation, if the private key ever leaks: paste a new public key here and
// ship an extension update. There is no PKI; the shipped build is the trust
// anchor.
export const LIVE_MANIFEST_PUBLIC_KEY = "2djNlrqulKixwivtxY3K94OuAje3vk7U/39G/6ZchrQ=";

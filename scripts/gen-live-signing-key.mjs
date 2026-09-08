// One-off: generates the Ed25519 keypair that signs live/manifest.json.
// Prints, never writes into the repo. Do this once, then:
//
//   1. Put the PRIVATE key PEM in a GitHub Actions secret named
//      LIVE_SIGNING_PRIVATE_KEY (or keep it offline and run
//      `LIVE_SIGNING_PRIVATE_KEY="$(cat key.pem)" npm run filters:update`
//      before every push that changes live/).
//   2. Paste the PUBLIC key (raw base64, 44 chars) into
//      src/shared/liveSigningKey.ts as LIVE_MANIFEST_PUBLIC_KEY.
//   3. Commit that + a re-run of `npm run filters:update` (which now also
//      writes live/manifest.json.sig).
//
// Until step 2 is done the channel runs exactly as before (hash-only). After
// it, a manifest whose signature doesn't verify is rejected, so a compromised
// GitHub account / CDN can no longer push rules -- only whoever holds this
// private key can. A leaked key is revoked by shipping an extension update
// with a new public key here; there is no PKI to rotate.
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
// SPKI DER for Ed25519 is a fixed 12-byte header + the 32-byte raw key.
const rawPublic = publicKey.export({ type: "spki", format: "der" }).subarray(12);

console.log("=== PRIVATE KEY (secret LIVE_SIGNING_PRIVATE_KEY, never commit) ===\n");
console.log(privatePem.trimEnd());
console.log("\n=== PUBLIC KEY (raw base64 -> src/shared/liveSigningKey.ts) ===\n");
console.log(rawPublic.toString("base64"));

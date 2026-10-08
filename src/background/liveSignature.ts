// Ed25519 signature check for the live-update manifest. Pure + side-effect-free
// so it's unit-testable; the fetch/apply flow lives in liveUpdates.ts.
//
// Outcomes rather than a boolean:
//   "ok"         -- a public key is configured, a signature was supplied, and
//                   it verifies. Trust the manifest.
//   "bad"        -- a key is configured and a signature was supplied, but it
//                   does NOT verify. Reject the manifest (keep the baseline).
//   "no-sig"     -- a key is configured but no signature was served. Reject:
//                   the per-file hashes live in the same unsigned manifest, so
//                   whoever can delete the .sig can also rewrite the payloads.
//   "no-key"     -- this build has no public key (signing not set up).
//   "no-engine"  -- this engine has no WebCrypto Ed25519. Reject: the
//                   hashes alone prove nothing (see "no-sig"). Every browser
//                   Moat supports has it (Chrome 137+, Firefox 140+), so this
//                   only happens on a broken or unusual engine, which keeps
//                   the bundled lists.
import { LIVE_MANIFEST_PUBLIC_KEY } from "../shared/liveSigningKey";

export type ManifestSigResult = "ok" | "bad" | "no-sig" | "no-key" | "no-engine";

/** Whether a manifest with this result may be applied. */
export function isManifestTrusted(result: ManifestSigResult): boolean {
  return result === "ok" || result === "no-key";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Fixed 12-byte SPKI/DER prefix for an Ed25519 public key. Wrapping the raw
// 32-byte key into SPKI keeps importKey portable -- "spki" is accepted
// everywhere, "raw" for Ed25519 public keys is newer and not universal.
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function rawEd25519ToSpki(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(ED25519_SPKI_PREFIX.length + raw.length);
  out.set(ED25519_SPKI_PREFIX, 0);
  out.set(raw, ED25519_SPKI_PREFIX.length);
  return out;
}

export async function verifyLiveManifest(
  manifestBytes: ArrayBuffer,
  signatureB64: string | null,
  publicKeyB64: string = LIVE_MANIFEST_PUBLIC_KEY,
): Promise<ManifestSigResult> {
  if (!publicKeyB64) return "no-key";
  if (!signatureB64) return "no-sig";

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      rawEd25519ToSpki(base64ToBytes(publicKeyB64)) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    // No Ed25519 in this engine's WebCrypto. The caller rejects the update.
    return "no-engine";
  }

  try {
    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      base64ToBytes(signatureB64) as BufferSource,
      manifestBytes,
    );
    return ok ? "ok" : "bad";
  } catch {
    return "bad";
  }
}

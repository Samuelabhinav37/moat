// Verifies a SignedAthenaPolicy envelope's Ed25519 signature
// against the org-provisioned public key in ManagedPolicy.athena.policyPublicKey
// before athenaPolicyRules.ts's parsePolicyArtifact ever looks at the payload.
// Kept free of webextension-polyfill, same as shared/hibp.ts, so it's
// testable without a browser extension context. This is the one place a
// remote-fetched policy can be trusted -- see athenaPolicySync.ts for how a
// failed verification here means the fetch is discarded outright, keeping
// whatever policy was last successfully verified.
import type { SignedAthenaPolicy } from "../types";

/**
 * Must byte-for-byte match Athena's own canonicalization
 * (`json.dumps(value, sort_keys=True, separators=(",", ":"))` in
 * `security_agents.py`) or every policy fails to verify -- sorted keys, no
 * whitespace, same as here. One real gap, currently dormant rather than
 * fixed: Python's `json.dumps` escapes non-ASCII characters by default
 * (`ensure_ascii=True`), `JSON.stringify` here does not. `AthenaPolicyArtifact`
 * only carries hostnames already validated ASCII-only (see
 * athenaPolicyRules.ts's HOSTNAME_PATTERN), so this never triggers today --
 * but a future field carrying free text would silently break verification
 * for any non-ASCII value. Flagging here rather than guessing a fix neither
 * side has coordinated on yet.
 */
export function canonicalPolicyPayload(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPolicyPayload).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalPolicyPayload(object[key])}`).join(",")}}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
}

/** True only if `signature` is a valid Ed25519 signature over the exact
 * UTF-8 bytes of `payload`, produced by the private key matching
 * `publicKeyJwk`. Any malformed input (bad base64, wrong key shape, wrong
 * curve) resolves to false rather than throwing -- callers should treat a
 * thrown error and a `false` result identically either way, but this keeps
 * the common "policy just doesn't verify" case from needing a try/catch at
 * every call site. */
export async function verifyPolicySignature(envelope: SignedAthenaPolicy, publicKeyJwk: JsonWebKey): Promise<boolean> {
  try {
    const key = await importVerifyKey(publicKeyJwk);
    // TS's DOM lib types SubtleCrypto.verify's last two params as
    // BufferSource, which a plain Uint8Array<ArrayBufferLike> (what both of
    // these are) doesn't structurally satisfy under the current lib target
    // -- the values themselves are fine at runtime, same as every other
    // crypto.subtle call in this codebase (see shared/hibp.ts).
    const signatureBytes = base64ToBytes(envelope.signature) as unknown as BufferSource;
    const payloadBytes = new TextEncoder().encode(envelope.payload) as unknown as BufferSource;
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, payloadBytes);
  } catch {
    return false;
  }
}

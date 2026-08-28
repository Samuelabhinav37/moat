import { describe, expect, it } from "vitest";
import { canonicalPolicyPayload, verifyPolicySignature } from "./athenaPolicySignature";

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function sign(payload: string, privateKey: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(payload));
  return bytesToBase64(signature);
}

describe("canonicalPolicyPayload", () => {
  // Must byte-for-byte match Athena's own canonicalization
  // (`json.dumps(value, sort_keys=True, separators=(",", ":"))`) or every
  // real fetched policy (an object, not a pre-serialized string) fails to
  // verify -- these pin the exact output, not just "it round-trips."
  it("sorts object keys and uses no whitespace", () => {
    expect(canonicalPolicyPayload({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys recursively in nested objects", () => {
    expect(canonicalPolicyPayload({ z: { d: 1, c: 2 }, a: 1 })).toBe('{"a":1,"z":{"c":2,"d":1}}');
  });

  it("preserves array order (arrays are ordered data, not sorted)", () => {
    expect(canonicalPolicyPayload({ blockedDomains: ["b.example", "a.example"] })).toBe(
      '{"blockedDomains":["b.example","a.example"]}'
    );
  });

  it("matches the exact shape of a real AthenaPolicyArtifact", () => {
    const artifact = { version: 1, issuedAt: 1_700_000_000_000, blockedDomains: ["evil.example"] };
    expect(canonicalPolicyPayload(artifact)).toBe(
      '{"blockedDomains":["evil.example"],"issuedAt":1700000000000,"version":1}'
    );
  });

  it("handles primitives and null the same way JSON.stringify does", () => {
    expect(canonicalPolicyPayload(null)).toBe("null");
    expect(canonicalPolicyPayload(42)).toBe("42");
    expect(canonicalPolicyPayload("x")).toBe('"x"');
    expect(canonicalPolicyPayload(true)).toBe("true");
  });

  it("round-trips through verifyPolicySignature the same way athenaPolicySync.ts actually uses it: sign the canonical form of a plain object, then verify against that same canonicalization", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    // Deliberately unsorted key order, the way a real JSON response parses --
    // canonicalPolicyPayload is what has to make this deterministic, not
    // whatever order fetch()'s .json() happened to preserve.
    const policy = { blockedDomains: ["evil.example"], version: 1, issuedAt: 1_700_000_000_000 };
    const payload = canonicalPolicyPayload(policy);
    const signature = await sign(payload, privateKey);

    await expect(verifyPolicySignature({ payload, signature }, publicKeyJwk)).resolves.toBe(true);
  });
});

describe("verifyPolicySignature", () => {
  it("verifies a genuine signature produced by the matching private key", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const payload = JSON.stringify({ version: 1, issuedAt: Date.now(), blockedDomains: ["evil.example"] });
    const signature = await sign(payload, privateKey);

    await expect(verifyPolicySignature({ payload, signature }, publicKeyJwk)).resolves.toBe(true);
  });

  it("rejects a payload that was tampered with after signing", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const payload = JSON.stringify({ version: 1, issuedAt: Date.now(), blockedDomains: ["evil.example"] });
    const signature = await sign(payload, privateKey);
    const tamperedPayload = JSON.stringify({ version: 1, issuedAt: Date.now(), blockedDomains: ["not-evil.example"] });

    await expect(verifyPolicySignature({ payload: tamperedPayload, signature }, publicKeyJwk)).resolves.toBe(false);
  });

  it("rejects a signature from a different key pair", async () => {
    const signer = await generateKeyPair();
    const impostor = await generateKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", impostor.publicKey);
    const payload = JSON.stringify({ version: 1, issuedAt: Date.now(), blockedDomains: ["evil.example"] });
    const signature = await sign(payload, signer.privateKey);

    await expect(verifyPolicySignature({ payload, signature }, publicKeyJwk)).resolves.toBe(false);
  });

  it("resolves false (never throws) for malformed base64 in the signature", async () => {
    const { publicKey } = await generateKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);

    await expect(verifyPolicySignature({ payload: "{}", signature: "not-valid-base64!!!" }, publicKeyJwk)).resolves.toBe(false);
  });

  it("resolves false (never throws) for a malformed public key", async () => {
    await expect(
      verifyPolicySignature({ payload: "{}", signature: "AA==" }, { kty: "oct" } as JsonWebKey)
    ).resolves.toBe(false);
  });
});

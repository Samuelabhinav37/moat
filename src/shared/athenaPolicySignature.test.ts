import { describe, expect, it } from "vitest";
import { verifyPolicySignature } from "./athenaPolicySignature";

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

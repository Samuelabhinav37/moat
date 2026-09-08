import { generateKeyPairSync, sign as edSign, createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLiveManifest } from "./liveSignature";

// A fresh Ed25519 keypair per run; raw 32-byte public key as base64, matching
// what scripts/gen-live-signing-key.mjs emits and liveSigningKey.ts holds.
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPubB64 = publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("base64");
  return { rawPubB64, privateKey };
}

const manifest = new TextEncoder().encode(JSON.stringify({ files: { "a.json": "deadbeef" } }, null, 2)).buffer;

function signB64(bytes: ArrayBuffer, privateKey: ReturnType<typeof createPrivateKey>) {
  return edSign(null, Buffer.from(bytes), privateKey).toString("base64");
}

describe("verifyLiveManifest", () => {
  it("returns 'ok' for a valid signature under the configured key", async () => {
    const { rawPubB64, privateKey } = keypair();
    expect(await verifyLiveManifest(manifest, signB64(manifest, privateKey), rawPubB64)).toBe("ok");
  });

  it("returns 'bad' when the signature is for different bytes", async () => {
    const { rawPubB64, privateKey } = keypair();
    const otherSig = signB64(new TextEncoder().encode("something else").buffer, privateKey);
    expect(await verifyLiveManifest(manifest, otherSig, rawPubB64)).toBe("bad");
  });

  it("returns 'bad' when the signature is from a different key", async () => {
    const a = keypair();
    const b = keypair();
    expect(await verifyLiveManifest(manifest, signB64(manifest, b.privateKey), a.rawPubB64)).toBe("bad");
  });

  it("returns 'bad' on a malformed signature string", async () => {
    const { rawPubB64 } = keypair();
    expect(await verifyLiveManifest(manifest, "not base64 !!!", rawPubB64)).toBe("bad");
  });

  it("returns 'unverified' when no key is configured", async () => {
    const { privateKey } = keypair();
    expect(await verifyLiveManifest(manifest, signB64(manifest, privateKey), "")).toBe("unverified");
  });

  it("returns 'unverified' when no signature was supplied", async () => {
    const { rawPubB64 } = keypair();
    expect(await verifyLiveManifest(manifest, null, rawPubB64)).toBe("unverified");
  });
});

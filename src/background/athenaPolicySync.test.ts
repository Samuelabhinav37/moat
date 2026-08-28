import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAndApplyPolicy, isPolicyBlockedHostname, isPolicySyncConfigured } from "./athenaPolicySync";
import { canonicalPolicyPayload } from "../shared/athenaPolicySignature";
import type { AthenaConfig } from "../types";

const updateDynamicRules = vi.fn().mockResolvedValue(undefined);

vi.mock("webextension-polyfill", () => {
  return {
    default: {
      declarativeNetRequest: {
        updateDynamicRules: (...args: unknown[]) => updateDynamicRules(...args),
      },
    },
  };
});

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
}

async function sign(payload: string, privateKey: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(payload));
  return bytesToBase64(signature);
}

async function buildConfig(): Promise<{ config: AthenaConfig; privateKey: CryptoKey }> {
  const { privateKey, publicKey } = await generateKeyPair();
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const config: AthenaConfig = {
    tenantId: "acme",
    agentId: "00000000-0000-4000-8000-000000000001",
    bootstrapUrl: "https://athena.acme.example/bootstrap",
    bootstrapSecret: "s3cret",
    eventsUrl: "https://athena.acme.example/events",
    policyUrl: "https://athena.acme.example/policy",
    policyPublicKey: publicKeyJwk,
  };
  return { config, privateKey };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  updateDynamicRules.mockClear();
});

describe("isPolicySyncConfigured", () => {
  it("is false when policyUrl isn't https", async () => {
    const { config } = await buildConfig();
    expect(isPolicySyncConfigured({ ...config, policyUrl: "http://athena.acme.example/policy" })).toBe(false);
  });

  it("is true when policyUrl and policyPublicKey are both set and https", async () => {
    const { config } = await buildConfig();
    expect(isPolicySyncConfigured(config)).toBe(true);
  });
});

describe("fetchAndApplyPolicy", () => {
  it("does nothing when policyUrl/policyPublicKey aren't both set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await fetchAndApplyPolicy({
      tenantId: "acme",
      agentId: "00000000-0000-4000-8000-000000000001",
      bootstrapUrl: "x",
      bootstrapSecret: "x",
      eventsUrl: "x",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies, parses, and applies a genuinely signed policy", async () => {
    const { config, privateKey } = await buildConfig();
    const policy = { version: 1, issuedAt: Date.now(), blockedDomains: ["evil.example"] };
    const payload = canonicalPolicyPayload(policy);
    const signature = await sign(payload, privateKey);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ policy, signature }) }));

    await fetchAndApplyPolicy(config, "agent-token");

    expect(updateDynamicRules).toHaveBeenCalledTimes(1);
    const [call] = updateDynamicRules.mock.calls[0] as [{ addRules: { condition: { urlFilter: string } }[] }];
    expect(call.addRules.map((r) => r.condition.urlFilter)).toEqual(["||evil.example^"]);
    expect(isPolicyBlockedHostname("evil.example")).toBe(true);
    expect(isPolicyBlockedHostname("sub.evil.example")).toBe(true);
    expect(isPolicyBlockedHostname("not-evil.example")).toBe(false);
  });

  it("discards a policy whose signature doesn't verify, and doesn't touch dynamic rules", async () => {
    const { config } = await buildConfig();
    const otherKeyPair = await generateKeyPair();
    const policy = { version: 1, issuedAt: Date.now(), blockedDomains: ["forged.example"] };
    const payload = canonicalPolicyPayload(policy);
    const signature = await sign(payload, otherKeyPair.privateKey);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ policy, signature }) }));

    await fetchAndApplyPolicy(config, "agent-token");

    expect(updateDynamicRules).not.toHaveBeenCalled();
    expect(isPolicyBlockedHostname("forged.example")).toBe(false);
  });

  it("keeps going (doesn't throw) when the endpoint is unreachable", async () => {
    const { config } = await buildConfig();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(fetchAndApplyPolicy(config, "agent-token")).resolves.toBeUndefined();
    expect(updateDynamicRules).not.toHaveBeenCalled();
  });
});

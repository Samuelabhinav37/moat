import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchAndApply end to end: the real signed manifest and payloads committed
// in live/, served by a stubbed fetch, checked by the real Ed25519 and
// SHA-256 code. Each test then breaks one thing and checks nothing from the
// network gets applied.

const storage: Record<string, unknown> = {};
const updateDynamicRules = vi.fn(async (_: unknown) => {});
vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(storage, items),
      },
    },
    declarativeNetRequest: { updateDynamicRules: (arg: unknown) => updateDynamicRules(arg) },
  },
}));
const addLiveRedirectDomains = vi.fn(async (_: string[]) => {});
vi.mock("./popupGuard", () => ({ addLiveRedirectDomains: (d: string[]) => addLiveRedirectDomains(d) }));
const storeLiveSecurityPayload = vi.fn(async (_: unknown) => 42);
vi.mock("./liveSecurityRules", () => ({ storeLiveSecurityPayload: (p: unknown) => storeLiveSecurityPayload(p) }));
vi.mock("./settings", () => ({ reapplySettings: async () => {} }));

import { fetchAndApply, getLiveUpdateStatus } from "./liveUpdates";

const LIVE_DIR = join(__dirname, "../../live");
const liveFile = (name: string): Uint8Array => new Uint8Array(readFileSync(join(LIVE_DIR, name)));

/** What the stubbed host serves: file name -> bytes, or a status code. */
let served: Record<string, Uint8Array | number>;
const fetched: string[] = [];

function serveCommittedLiveFiles(): void {
  served = {};
  for (const name of [
    "manifest.json",
    "manifest.json.sig",
    "redirect-domains.json",
    "quick-fixes.json",
    "cosmetic-fixes.json",
    "security-domains.json",
  ]) {
    served[name] = liveFile(name);
  }
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  updateDynamicRules.mockClear();
  addLiveRedirectDomains.mockClear();
  storeLiveSecurityPayload.mockClear();
  fetched.length = 0;
  serveCommittedLiveFiles();
  vi.stubGlobal("fetch", async (url: string) => {
    const name = url.slice(url.lastIndexOf("/") + 1);
    fetched.push(name);
    const body = served[name];
    if (body === undefined || typeof body === "number") {
      return new Response(null, { status: typeof body === "number" ? body : 404, statusText: "Not Found" });
    }
    return new Response(body.slice().buffer as ArrayBuffer, { status: 200 });
  });
});

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("fetchAndApply with the committed live files", () => {
  it("accepts the signed manifest and applies every channel", async () => {
    await fetchAndApply({ force: true });
    const status = await getLiveUpdateStatus();
    const domains = JSON.parse(text(liveFile("redirect-domains.json"))) as string[];

    expect(status?.ok).toBe(true);
    expect(status?.domainCount).toBe(domains.length);
    expect(status?.securityDomainCount).toBe(42);
    expect(addLiveRedirectDomains).toHaveBeenCalledTimes(1);
    expect(storeLiveSecurityPayload).toHaveBeenCalledWith(JSON.parse(text(liveFile("security-domains.json"))));
    expect(updateDynamicRules).toHaveBeenCalled();
  });

  it("skips the network when the last good fetch is recent, unless forced", async () => {
    storage.liveUpdateStatus = { ok: true, timestamp: Date.now() };
    await fetchAndApply();
    expect(fetched).toEqual([]);

    await fetchAndApply({ force: true });
    expect(fetched).toContain("manifest.json");
  });
});

describe("fetchAndApply rejects what it can't trust", () => {
  async function expectNothingApplied(): Promise<void> {
    await fetchAndApply({ force: true });
    expect((await getLiveUpdateStatus())?.ok).toBe(false);
    expect(addLiveRedirectDomains).not.toHaveBeenCalled();
    expect(updateDynamicRules).not.toHaveBeenCalled();
    expect(storeLiveSecurityPayload).not.toHaveBeenCalled();
  }

  it("a manifest changed after signing (one hash swapped)", async () => {
    const manifest = JSON.parse(text(liveFile("manifest.json"))) as { files: Record<string, string> };
    const evil = bytesOf('["evil.example"]');
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", evil.slice().buffer as ArrayBuffer))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    manifest.files["redirect-domains.json"] = hash;
    served["manifest.json"] = bytesOf(JSON.stringify(manifest));
    served["redirect-domains.json"] = evil;
    await expectNothingApplied();
  });

  it("a missing signature (the .sig deleted from the host)", async () => {
    delete served["manifest.json.sig"];
    await expectNothingApplied();
  });

  it("a missing signature with the payloads and their hashes rewritten to match", async () => {
    const manifest = JSON.parse(text(liveFile("manifest.json"))) as { files: Record<string, string> };
    const evil = bytesOf('["evil.example"]');
    manifest.files["redirect-domains.json"] = [...new Uint8Array(await crypto.subtle.digest("SHA-256", evil.slice().buffer as ArrayBuffer))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    served["manifest.json"] = bytesOf(JSON.stringify(manifest));
    served["redirect-domains.json"] = evil;
    delete served["manifest.json.sig"];
    await expectNothingApplied();
  });

  it("a signature that isn't valid base64 Ed25519 for this manifest", async () => {
    served["manifest.json.sig"] = bytesOf(btoa("x".repeat(64)));
    await expectNothingApplied();
  });

  it("a payload that doesn't match its manifest hash", async () => {
    served["redirect-domains.json"] = bytesOf('["evil.example"]');
    await expectNothingApplied();
  });

  it("the host failing to serve the manifest", async () => {
    served["manifest.json"] = 503;
    await expectNothingApplied();
  });

  it("an older, validly signed manifest replayed after a newer one was applied", async () => {
    // The committed manifest has no sequence, as every one signed before
    // 0.11.251 does: once a sequenced manifest was accepted, it's a replay.
    storage.liveManifestSequence = 1_791_000_000;
    await expectNothingApplied();
  });
});


describe("fetchAndApply's secondary channels fail on their own", () => {
  it("a bad security list keeps the rest and the last good security list", async () => {
    served["security-domains.json"] = bytesOf("{}");
    await fetchAndApply({ force: true });
    const status = await getLiveUpdateStatus();
    expect(status?.ok).toBe(true);
    expect(status?.securityDomainCount).toBeUndefined();
    expect(storeLiveSecurityPayload).not.toHaveBeenCalled();
    expect(addLiveRedirectDomains).toHaveBeenCalledTimes(1);
  });

  it("a bad cosmetic-fixes file leaves stored fixes alone", async () => {
    storage.liveCosmeticFixes = { "example.com": [".kept"] };
    served["cosmetic-fixes.json"] = bytesOf('{"example.com":[".evil"]}');
    await fetchAndApply({ force: true });
    expect((await getLiveUpdateStatus())?.ok).toBe(true);
    expect(Object.values(storage).some((v) => JSON.stringify(v)?.includes(".evil"))).toBe(false);
  });
});

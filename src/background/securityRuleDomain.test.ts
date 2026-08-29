import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSecurityRuleDomain } from "./securityRuleDomain";

vi.mock("webextension-polyfill", () => {
  return {
    default: {
      runtime: { getURL: (path: string) => `test://${path}` },
    },
  };
});

const MANIFEST = [
  { id: "ruleset_malicious-urls", group: "malicious-urls", category: "security", name: "Malicious URLs", enabled: true, file: "ruleset_malicious-urls.json", ruleCount: 3 },
  { id: "ruleset_unreachable", group: "malicious-urls", category: "security", name: "Unreachable", enabled: true, file: "ruleset_unreachable.json", ruleCount: 0 },
];

const RULES = [
  { id: 1, condition: { urlFilter: "||evil.example^", resourceTypes: ["main_frame"] } },
  { id: 2, condition: { urlFilter: "||sub.also-evil.example/path^", resourceTypes: ["main_frame"] } },
  { id: 3, condition: { requestDomains: ["domain-condition.example"] } },
  { id: 4, condition: { regexFilter: "^https?://.*\\.exfil\\..*$" } },
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "test://rules/manifest.json") return Promise.resolve({ json: () => Promise.resolve(MANIFEST) });
      if (url === "test://rules/ruleset_malicious-urls.json") return Promise.resolve({ json: () => Promise.resolve(RULES) });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    })
  );
}

describe("resolveSecurityRuleDomain", () => {
  it("extracts a plain ||domain^-anchored urlFilter", async () => {
    stubFetch();
    await expect(resolveSecurityRuleDomain("ruleset_malicious-urls", 1)).resolves.toBe("evil.example");
  });

  it("extracts the domain from a urlFilter with a path after it", async () => {
    stubFetch();
    await expect(resolveSecurityRuleDomain("ruleset_malicious-urls", 2)).resolves.toBe("sub.also-evil.example");
  });

  it("prefers requestDomains over urlFilter when both could apply", async () => {
    stubFetch();
    await expect(resolveSecurityRuleDomain("ruleset_malicious-urls", 3)).resolves.toBe("domain-condition.example");
  });

  it("resolves to null for a regexFilter-based rule with no domain-shaped condition", async () => {
    stubFetch();
    await expect(resolveSecurityRuleDomain("ruleset_malicious-urls", 4)).resolves.toBeNull();
  });

  it("resolves to null for a ruleId that isn't in the ruleset at all", async () => {
    stubFetch();
    await expect(resolveSecurityRuleDomain("ruleset_malicious-urls", 999)).resolves.toBeNull();
  });

  it("resolves to null for a rulesetId not in the manifest", async () => {
    stubFetch();
    await expect(resolveSecurityRuleDomain("unknown-ruleset", 1)).resolves.toBeNull();
  });

  it("resolves to null (never throws) when ruleId is undefined", async () => {
    stubFetch();
    await expect(resolveSecurityRuleDomain("ruleset_malicious-urls", undefined)).resolves.toBeNull();
  });

  it("resolves to null (never throws) when the ruleset fetch fails", async () => {
    // A distinct, never-yet-cached rulesetId -- module-level caches (both
    // this file's own domainIndexCache and rulesetManifestLoader's) persist
    // across tests, so reusing ruleset_malicious-urls here would return an
    // already-cached result rather than actually exercising the fetch
    // failure path.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "test://rules/manifest.json") return Promise.resolve({ json: () => Promise.resolve(MANIFEST) });
        return Promise.reject(new Error(`unreachable: ${url}`));
      })
    );
    await expect(resolveSecurityRuleDomain("ruleset_unreachable", 1)).resolves.toBeNull();
  });
});

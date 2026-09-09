import { beforeEach, describe, expect, it, vi } from "vitest";
import { tokenHash } from "../shared/tokenHash";

// The module reads its data through the polyfill's runtime.getURL + the
// global fetch; stub getURL to a bare path so the fetch mock can switch on it.
vi.mock("webextension-polyfill", () => ({
  default: { runtime: { getURL: (path: string) => path } },
}));

const MANIFEST = { meta: "cosmetics-meta.json", bucketCount: 4 };
const META = {
  genericByHash: { [tokenHash("adbox")]: [".adbox", ".adbox-2"] },
  genericHigh: [".sponsored", ".ad-except"],
  exceptions: { "example.com": [".ad-except", ".adbox-2", ".excepted:has-text(x)"] },
  injectGeneric: [["#promo", "height:0!important"]],
  proceduralGeneric: [{ s: ".g", t: [["has-text", "Ad"]], x: ".g:has-text(Ad)" }],
  proceduralPerDomain: {
    "example.com": [
      { s: ".p", t: [["upward", 1]], x: ".p:upward(1)" },
      { s: ".excepted", t: [["has-text", "x"]], x: ".excepted:has-text(x)" },
    ],
  },
};
// Every bucket returns the same entry so the test doesn't depend on which
// bucket "example.com" hashes into.
const BUCKET = { "example.com": { h: [".domain-ad"], i: [["#dp", "display:none!important"]] } };

let fetchMock: ReturnType<typeof vi.fn>;

async function load() {
  vi.resetModules();
  return import("./cosmeticIndex");
}

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    const body =
      url === "rules/cosmetics-manifest.json"
        ? MANIFEST
        : url === "rules/cosmetics-meta.json"
          ? META
          : /^rules\/cosmetics-bucket-\d+\.json$/.test(url)
            ? BUCKET
            : undefined;
    return Promise.resolve({ json: () => Promise.resolve(body) });
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("cosmeticSliceFor", () => {
  it("returns the per-domain, inject, and generic-high slices for a hostname", async () => {
    const { cosmeticSliceFor } = await load();
    const slice = await cosmeticSliceFor("example.com");

    expect(slice.domainSelectors).toEqual([".domain-ad"]);
    expect(slice.genericHigh).toEqual([".sponsored"]); // .ad-except is excepted for example.com
    expect(slice.injectRules).toEqual([
      ["#promo", "height:0!important"],
      ["#dp", "display:none!important"],
    ]);
    expect(slice.hasTokenIndex).toBe(true);
  });

  it("fetches the meta file only once across calls", async () => {
    const { cosmeticSliceFor } = await load();
    await cosmeticSliceFor("example.com");
    await cosmeticSliceFor("test.example.com");
    const metaFetches = fetchMock.mock.calls.filter(([u]) => u === "rules/cosmetics-meta.json");
    expect(metaFetches).toHaveLength(1);
  });

  it("reports hasTokenIndex false when the generic hash map is empty", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        json: () =>
          Promise.resolve(
            url === "rules/cosmetics-manifest.json"
              ? MANIFEST
              : url === "rules/cosmetics-meta.json"
                ? { ...META, genericByHash: {} }
                : BUCKET
          ),
      })
    );
    const { cosmeticSliceFor } = await load();
    expect((await cosmeticSliceFor("example.com")).hasTokenIndex).toBe(false);
  });
});

describe("cosmeticGenericsFor", () => {
  it("resolves token hashes to their generic selectors, minus this host's exceptions", async () => {
    const { cosmeticGenericsFor } = await load();
    expect(await cosmeticGenericsFor("example.com", [tokenHash("adbox")])).toEqual({ selectors: [".adbox"] });
    // A different host keeps the selector example.com excepts.
    expect((await cosmeticGenericsFor("other.com", [tokenHash("adbox")])).selectors.sort()).toEqual([
      ".adbox",
      ".adbox-2",
    ]);
  });

  it("returns nothing for an unknown hash", async () => {
    const { cosmeticGenericsFor } = await load();
    expect(await cosmeticGenericsFor("example.com", ["deadbeef"])).toEqual({ selectors: [] });
  });

  it("needs the meta file only, never a bucket", async () => {
    const { cosmeticGenericsFor } = await load();
    await cosmeticGenericsFor("example.com", [tokenHash("adbox")]);
    expect(fetchMock.mock.calls.some(([u]) => /bucket/.test(u))).toBe(false);
  });

  it("caps an oversized hash array without throwing", async () => {
    const { cosmeticGenericsFor, MAX_TOKEN_HASHES } = await load();
    const hashes = Array.from({ length: MAX_TOKEN_HASHES + 500 }, (_, i) => `h${i}`);
    hashes.push(tokenHash("adbox"));
    // The real hash is past the cap, so it's dropped -- the point is just
    // that a flood is bounded, not rejected.
    const res = await cosmeticGenericsFor("example.com", hashes);
    expect(Array.isArray(res.selectors)).toBe(true);
  });
});

describe("proceduralRulesFor", () => {
  it("returns the generic rules plus this host's per-domain rules, minus exceptions", async () => {
    const { proceduralRulesFor } = await load();
    const { rules } = await proceduralRulesFor("example.com");
    expect(rules.map((r) => r.x)).toEqual([".g:has-text(Ad)", ".p:upward(1)"]);
    // .excepted:has-text(x) is #@#-excepted for example.com and dropped.
  });

  it("keeps a rule that a different host doesn't except", async () => {
    const { proceduralRulesFor } = await load();
    const { rules } = await proceduralRulesFor("other.com");
    expect(rules.map((r) => r.x)).toEqual([".g:has-text(Ad)"]);
  });

  it("needs the meta file only, never a bucket", async () => {
    const { proceduralRulesFor } = await load();
    await proceduralRulesFor("example.com");
    expect(fetchMock.mock.calls.some(([u]) => /bucket/.test(u))).toBe(false);
  });
});

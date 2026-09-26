import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));
const { MAX_SELECTORS_PER_SITE, MAX_SITES, recall, remember } = await import("./genericSelectorCache");

const fresh = () => ({ version: "1", sites: new Map<string, string[]>() });

describe("generic selector cache", () => {
  it("remembers and merges a site's selectors without duplicates", () => {
    const s = fresh();
    remember(s, "news.example", ["#ad_banner", ".ad-slot"]);
    remember(s, "news.example", [".ad-slot", "#carbonads"]);
    expect(recall(s, "news.example")).toEqual(["#ad_banner", ".ad-slot", "#carbonads"]);
    expect(recall(s, "other.example")).toEqual([]);
  });

  it("caps selectors per site", () => {
    const s = fresh();
    remember(s, "a.example", Array.from({ length: MAX_SELECTORS_PER_SITE + 50 }, (_, i) => `.s${i}`));
    expect(recall(s, "a.example")).toHaveLength(MAX_SELECTORS_PER_SITE);
  });

  it("drops the least recently used site past the limit", () => {
    const s = fresh();
    for (let i = 0; i < MAX_SITES; i++) remember(s, `site${i}.example`, [".x"]);
    remember(s, "site0.example", [".y"]); // site0 is now the most recent
    remember(s, "new.example", [".z"]);
    expect(s.sites.size).toBe(MAX_SITES);
    expect(recall(s, "site1.example")).toEqual([]);
    expect(recall(s, "site0.example")).toEqual([".x", ".y"]);
  });

  it("ignores empty results", () => {
    const s = fresh();
    remember(s, "a.example", []);
    expect(s.sites.size).toBe(0);
  });
});

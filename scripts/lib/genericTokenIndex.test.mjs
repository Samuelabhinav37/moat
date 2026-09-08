import { describe, expect, it } from "vitest";
import { tokenHash } from "./tokenHash.mjs";
import {
  extractAnchorToken,
  partitionGenericSelectors,
  splitSelectorList,
} from "./genericTokenIndex.mjs";

describe("splitSelectorList", () => {
  it("splits a top-level list", () => {
    expect(splitSelectorList(".a, .b , .c")).toEqual([".a", ".b", ".c"]);
  });

  it("keeps commas inside :has()/:is()/[attr] together", () => {
    expect(splitSelectorList(".x:has(.a, .b)")).toEqual([".x:has(.a, .b)"]);
    expect(splitSelectorList('[data-x=","]')).toEqual(['[data-x=","]']);
  });

  it("returns a single element for a plain selector", () => {
    expect(splitSelectorList(".ad-banner")).toEqual([".ad-banner"]);
  });
});

describe("extractAnchorToken", () => {
  it("takes the token of a bare class or id selector", () => {
    expect(extractAnchorToken(".ad-banner")).toBe("ad-banner");
    expect(extractAnchorToken("#ad-container")).toBe("ad-container");
  });

  it("takes the right-most compound's class/id", () => {
    expect(extractAnchorToken(".feed .promoted")).toBe("promoted");
    expect(extractAnchorToken(".container > .ad-slot")).toBe("ad-slot");
    expect(extractAnchorToken("div.wrap ~ span.sponsor")).toBe("sponsor");
  });

  it("takes the last class of a multi-class compound", () => {
    expect(extractAnchorToken(".box.ad.rendered")).toBe("rendered");
  });

  it("ignores tokens inside [attr] and :has()/:not() arguments", () => {
    expect(extractAnchorToken('.wrap[data-ad="1"]')).toBe("wrap");
    expect(extractAnchorToken(".panel:has(.sponsored)")).toBe("panel");
    expect(extractAnchorToken(".card:not(.kept)")).toBe("card");
  });

  it("returns null when the right-most compound has no class/id", () => {
    expect(extractAnchorToken("[data-ad]")).toBeNull();
    expect(extractAnchorToken("div > *")).toBeNull();
    expect(extractAnchorToken('a[href*="/ads/"]')).toBeNull();
    expect(extractAnchorToken(".wrap [data-ad]")).toBeNull();
  });
});

describe("partitionGenericSelectors", () => {
  it("files anchored selectors under their token hash and leaves the rest high", () => {
    const { genericByHash, genericHigh } = partitionGenericSelectors([
      ".ad-banner",
      ".feed .promoted",
      "[data-ad]",
      'a[href*="/ads/"]',
    ]);
    expect(genericByHash[tokenHash("ad-banner")]).toEqual([".ad-banner"]);
    expect(genericByHash[tokenHash("promoted")]).toEqual([".feed .promoted"]);
    expect(genericHigh).toEqual(["[data-ad]", 'a[href*="/ads/"]']);
  });

  it("files a selector list under every part's hash, and only if all parts anchor", () => {
    const { genericByHash, genericHigh } = partitionGenericSelectors([
      ".ad, .promo",
      ".ad, [data-x]",
    ]);
    expect(genericByHash[tokenHash("ad")]).toContain(".ad, .promo");
    expect(genericByHash[tokenHash("promo")]).toContain(".ad, .promo");
    expect(genericHigh).toEqual([".ad, [data-x]"]);
  });

  it("drops nothing: every input lands in exactly one place", () => {
    const input = [
      ".ad-banner",
      ".feed .promoted",
      "[data-ad]",
      ".a.b.c",
      ".x, .y",
      'a[href*="/ads/"]',
      "#promo",
    ];
    const { genericByHash, genericHigh } = partitionGenericSelectors(input);
    const filed = new Set(genericHigh);
    for (const list of Object.values(genericByHash)) for (const s of list) filed.add(s);
    expect([...filed].sort()).toEqual([...input].sort());
  });

  it("sorts hash buckets and the high list", () => {
    const { genericByHash, genericHigh } = partitionGenericSelectors([
      ".zeta.ad",
      ".alpha.ad",
      "[z-attr]",
      "[a-attr]",
    ]);
    expect(genericByHash[tokenHash("ad")]).toEqual([".alpha.ad", ".zeta.ad"]);
    expect(genericHigh).toEqual(["[a-attr]", "[z-attr]"]);
  });
});

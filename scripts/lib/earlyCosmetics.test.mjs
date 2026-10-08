import { describe, expect, it } from "vitest";
import { buildEarlyCosmetics } from "./earlyCosmetics.mjs";

describe("buildEarlyCosmetics", () => {
  const meta = {
    genericHigh: ["#ad_banner", ".ad-slot"],
    genericByHash: { a1: [".sponsor", ".promo-box"], b2: [".ad-slot", ".deal"] },
    exceptions: { "shop.example": [".sponsor"], "news.example": [".ad-slot"], "ebay.*": [".deal"] },
  };
  const out = buildEarlyCosmetics(meta);

  it("hides selectors no site excepts, from both the always-on and token-filed lists", () => {
    expect(out.css).toBe("#ad_banner,.promo-box{display:none!important}");
  });

  it("puts selectors excepted only on plain domains in their own file, with those domains to leave out", () => {
    expect(out.exceptedCss).toBe(".ad-slot,.sponsor{display:none!important}");
    expect(out.excludeDomains).toEqual(["news.example", "shop.example"]);
  });

  it("leaves a selector excepted on a wildcard domain to the worker", () => {
    expect(out.css + out.exceptedCss).not.toContain(".deal");
  });
});

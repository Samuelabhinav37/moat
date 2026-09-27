// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BRANDS, buildBrandLogo, buildBrandTile, prependBrand, type BrandId } from "./brandIcons";

describe("brand logos", () => {
  it("has a colour and path for every brand", () => {
    for (const [id, brand] of Object.entries(BRANDS)) {
      expect(brand.hex, id).toMatch(/^#[0-9A-F]{6}$/);
      expect(brand.path.length, id).toBeGreaterThan(50);
    }
  });

  it("draws a decorative SVG in the brand colour", () => {
    const svg = buildBrandLogo(document, "cloudflare", 16);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.querySelector("path")!.getAttribute("fill")).toBe(BRANDS.cloudflare.hex);
  });

  it("puts a white plate behind YouTube's cut-out play arrow only", () => {
    expect(buildBrandLogo(document, "youtube").querySelector("rect")).not.toBeNull();
    expect(buildBrandLogo(document, "google").querySelector("rect")).toBeNull();
  });

  it("stacks several logos in one tile", () => {
    const ids: BrandId[] = ["instagram", "youtube"];
    const tile = buildBrandTile(document, ids);
    expect(tile.classList.contains("brand-stack")).toBe(true);
    expect(tile.querySelectorAll("svg")).toHaveLength(2);
    expect(buildBrandTile(document, ["youtube"]).classList.contains("brand-stack")).toBe(false);
  });

  it("puts one logo before a name, even when called again after a re-render", () => {
    const el = document.createElement("strong");
    el.textContent = "Google";
    prependBrand(el, "google");
    prependBrand(el, "google");
    expect(el.querySelectorAll("svg")).toHaveLength(1);
    expect(el.textContent).toBe("Google");
  });
});

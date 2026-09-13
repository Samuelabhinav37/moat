import { describe, expect, it } from "vitest";
import { contrastRatio, INVISIBLE_TEXT_CONTRAST_FLOOR, isTransparent, parseColor, relativeLuminance } from "./colorContrast";

describe("parseColor", () => {
  it("parses rgb()", () => {
    expect(parseColor("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("parses rgba() with a fractional alpha", () => {
    expect(parseColor("rgba(255, 255, 255, 0.82)")).toEqual({ r: 255, g: 255, b: 255, a: 0.82 });
  });

  it("returns null for an unresolved var() string", () => {
    // What getComputedStyle() returns in jsdom for `color: var(--t2)` --
    // jsdom doesn't substitute var() into other properties, only resolves
    // a custom property's own value via getPropertyValue(). See
    // findInvisibleText.ts's resolveVarColor for the workaround.
    expect(parseColor("var(--t2)")).toBeNull();
  });

  it("returns null for keyword colors and garbage", () => {
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("red")).toBeNull();
    expect(parseColor("")).toBeNull();
  });
});

describe("isTransparent", () => {
  it("is true for alpha 0", () => {
    expect(isTransparent("rgba(0, 0, 0, 0)")).toBe(true);
  });

  it("is true for an unparseable value (treated as no background here)", () => {
    expect(isTransparent("transparent")).toBe(true);
  });

  it("is false for an opaque color", () => {
    expect(isTransparent("rgb(255, 255, 255)")).toBe(false);
  });

  it("is false for a partially transparent but non-zero alpha", () => {
    expect(isTransparent("rgba(0, 0, 0, 0.5)")).toBe(false);
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black against white", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
  });

  it("is 1 for identical colors", () => {
    expect(contrastRatio({ r: 120, g: 80, b: 200 }, { r: 120, g: 80, b: 200 })).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    const a = { r: 20, g: 200, b: 100 };
    const b = { r: 240, g: 30, b: 60 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  // The actual v0.11.89 bug: near-white text (rgba(255,255,255,0.82) over an
  // opaque white card) is far below the invisible-text floor.
  it("flags the exact v0.11.89 regression as below the invisible-text floor", () => {
    const nearWhiteText = { r: 255, g: 255, b: 255 }; // alpha composited out by the caller before this point
    const whiteCard = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(nearWhiteText, whiteCard)).toBeLessThan(INVISIBLE_TEXT_CONTRAST_FLOOR);
  });

  it("does not flag real, legible on-white text used elsewhere in the product", () => {
    const darkText = { r: 0x38, g: 0x37, b: 0x3b }; // .host's #38373b
    const whiteCard = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(darkText, whiteCard)).toBeGreaterThan(INVISIBLE_TEXT_CONTRAST_FLOOR);
  });
});

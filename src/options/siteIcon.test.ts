// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSiteIcon, faviconUrl, isLightIcon, samePixels, siteInitial } from "./siteIcon";

const getURL = (path: string) => `chrome-extension://abc${path}`;

describe("siteInitial", () => {
  it("uses the first letter or digit, skipping www.", () => {
    expect(siteInitial("reddit.com")).toBe("R");
    expect(siteInitial("www.bbc.co.uk")).toBe("B");
    expect(siteInitial("9gag.com")).toBe("9");
    expect(siteInitial("münchen.de")).toBe("M");
    expect(siteInitial("---")).toBe("?");
  });
});

describe("faviconUrl", () => {
  it("asks the browser's own icon cache for the site's https page", () => {
    const url = new URL(faviconUrl("reddit.com", getURL, true)!);
    expect(url.href.startsWith("chrome-extension://abc/_favicon/?")).toBe(true);
    expect(url.searchParams.get("pageUrl")).toBe("https://reddit.com/");
    expect(url.searchParams.get("size")).toBe("32");
  });

  it("gives nothing where there is no cache to ask", () => {
    expect(faviconUrl("reddit.com", getURL, false)).toBeNull();
  });
});

describe("buildSiteIcon", () => {
  it("shows the letter until the icon loads, then the icon", () => {
    const tile = buildSiteIcon(document, "reddit.com", "chrome-extension://abc/_favicon/?pageUrl=x");
    expect(tile.textContent).toBe("R");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.querySelector("img")).toBeNull();
  });

  it("keeps the letter when there's no icon to load", () => {
    const tile = buildSiteIcon(document, "example.org", null);
    expect(tile.textContent).toBe("E");
    expect(tile.classList.contains("has-img")).toBe(false);
  });
});

/** A 2x2 picture from [r, g, b, a] pixels. */
const pixels = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

describe("isLightIcon", () => {
  it("is true for a white logo on transparency (GitHub on a dark theme)", () => {
    expect(isLightIcon(pixels([255, 255, 255, 255], [250, 250, 250, 255], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe(true);
  });

  it("is false for a dark or colourful logo, and for a blank one", () => {
    expect(isLightIcon(pixels([20, 20, 20, 255], [255, 255, 255, 255], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe(false);
    expect(isLightIcon(pixels([255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe(false);
    expect(isLightIcon(pixels([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe(false);
  });
});

describe("samePixels", () => {
  it("matches Chrome's default globe pixel for pixel, and nothing when unreadable", () => {
    const globe = pixels([120, 120, 120, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(samePixels(globe, pixels([120, 120, 120, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe(true);
    expect(samePixels(globe, pixels([121, 120, 120, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]))).toBe(false);
    expect(samePixels(null, globe)).toBe(false);
  });
});

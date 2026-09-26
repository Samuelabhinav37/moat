// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSiteIcon, faviconUrl, siteInitial } from "./siteIcon";

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

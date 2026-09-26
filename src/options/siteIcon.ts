// A small site icon beside each hostname in the Settings lists, so a long
// list can be scanned by logo. On Chrome it comes from the browser's own
// favicon cache (the "favicon" permission and the extension's /_favicon/
// endpoint): no network request, nothing leaves the device. Where that
// isn't available (Firefox), or the browser has no icon for the site yet,
// a tile with the site's first letter stands in.

/** The site's first letter or digit, skipping a leading "www.". */
export function siteInitial(hostname: string): string {
  const name = hostname.replace(/^www\./i, "");
  const match = name.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : "?";
}

/** The browser's cached icon for a site, or null where there isn't a cache to ask. */
export function faviconUrl(hostname: string, getURL: (path: string) => string, supported: boolean): string | null {
  if (!supported) return null;
  const url = new URL(getURL("/_favicon/"));
  url.searchParams.set("pageUrl", `https://${hostname}/`);
  url.searchParams.set("size", "32");
  return url.toString();
}

export function buildSiteIcon(doc: Document, hostname: string, src: string | null): HTMLElement {
  const tile = doc.createElement("span");
  tile.className = "site-icon";
  tile.setAttribute("aria-hidden", "true");
  tile.textContent = siteInitial(hostname);
  if (src) {
    const img = doc.createElement("img");
    img.alt = "";
    img.width = 16;
    img.height = 16;
    img.decoding = "async";
    img.src = src;
    // Keep the letter until the icon has actually loaded.
    img.addEventListener("load", () => {
      tile.textContent = "";
      tile.classList.add("has-img");
      tile.append(img);
    });
  }
  return tile;
}

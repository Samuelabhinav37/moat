// A small site icon beside each hostname in the Settings lists, so a long
// list can be scanned by logo. On Chrome it comes from the browser's own
// favicon cache (the "favicon" permission and the extension's /_favicon/
// endpoint): no network request, nothing leaves the device. Where that
// isn't available (Firefox), or the browser has no icon for the site yet,
// a tile with the site's first letter stands in.
//
// Two things the cache does that need handling, both read from the icon's
// pixels (the /_favicon/ URL is the extension's own origin, so a canvas can
// read it):
// - For a site it has no icon for, Chrome returns its grey globe, not an
//   error, so the letter tile would never show. The globe is recognized by
//   comparing against the icon Chrome gives for a site that can't exist.
// - Some sites serve a white logo to dark themes (GitHub). On the usual
//   white plate that's invisible, so a light icon gets a dark plate.

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

/** A reserved name (RFC 2606) no one can own, so Chrome has no icon for it
 * and answers with its default globe. */
export const NO_ICON_HOSTNAME = "moat-no-icon.invalid";

const SAMPLE = 16;

/** The icon's pixels at a fixed small size, or null when they can't be
 * read (no canvas, or a cross-origin image). */
export function readPixels(doc: Document, img: HTMLImageElement): Uint8ClampedArray | null {
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    return context.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }
}

/** Same picture, pixel for pixel. */
export function samePixels(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when the icon's visible pixels are mostly very light, so it would
 * vanish on a white plate. Transparent pixels don't count. */
export function isLightIcon(pixels: Uint8ClampedArray): boolean {
  let visible = 0;
  let light = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    visible++;
    const luminance = 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
    if (luminance > 215) light++;
  }
  return visible > 0 && light / visible > 0.8;
}

let defaultIcon: Promise<Uint8ClampedArray | null> | null = null;

/** The pixels of Chrome's default globe, read once per page. */
function defaultIconPixels(doc: Document, src: string): Promise<Uint8ClampedArray | null> {
  if (!defaultIcon) {
    const url = new URL(src);
    url.searchParams.set("pageUrl", `https://${NO_ICON_HOSTNAME}/`);
    defaultIcon = new Promise((resolve) => {
      const probe = doc.createElement("img");
      probe.addEventListener("load", () => resolve(readPixels(doc, probe)));
      probe.addEventListener("error", () => resolve(null));
      probe.src = url.toString();
    });
  }
  return defaultIcon;
}

/** One of six tile hues for a name, the same every time. */
export function monogramHue(name: string): number {
  let hash = 0;
  for (const ch of name.replace(/^www\./i, "").toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash % 6;
}

export function buildSiteIcon(doc: Document, hostname: string, src: string | null): HTMLElement {
  const tile = doc.createElement("span");
  tile.className = "site-icon";
  tile.setAttribute("aria-hidden", "true");
  tile.textContent = siteInitial(hostname);
  tile.dataset.hue = String(monogramHue(hostname));
  if (src) {
    const img = doc.createElement("img");
    img.alt = "";
    img.width = 16;
    img.height = 16;
    img.decoding = "async";
    img.src = src;
    // Keep the letter until the icon has loaded and turned out to be the
    // site's own.
    img.addEventListener("load", () => {
      void defaultIconPixels(doc, src).then((globe) => {
        const pixels = readPixels(doc, img);
        if (samePixels(pixels, globe)) return;
        tile.textContent = "";
        delete tile.dataset.hue;
        tile.classList.add("has-img");
        if (pixels && isLightIcon(pixels)) tile.classList.add("light-img");
        tile.append(img);
      });
    });
  }
  return tile;
}

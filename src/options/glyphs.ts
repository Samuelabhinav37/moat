// Small line glyphs for the icon tiles that have no site icon to show: a
// page Moat stopped never loaded, so the browser has no icon for it, and the
// tile says what kind of page it was instead. Drawn with DOM calls (no
// innerHTML), on a 24 by 24 grid like the rest of Settings' icons.

const SVG_NS = "http://www.w3.org/2000/svg";

export const GLYPHS = {
  // A lock with a warning mark: a fake sign-in page.
  phishing: ["M5 10.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z", "M6.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3", "M21 9v5", "M21 17.5v.01"],
  // A cart: a fake shop or giveaway.
  scam: ["M3 4h2.5l2.2 10.5h10l2-7.5H6.5", "M9.5 19h.01", "M16.5 19h.01"],
  // A bug: malware or a risky download.
  malware: ["M9.5 8h5a3 3 0 0 1 3 3v4a5.5 5.5 0 0 1-11 0v-4a3 3 0 0 1 3-3z", "M12 8v12", "M9.5 8a2.5 2.5 0 0 1 5 0", "M3.5 13h3M17.5 13h3", "M5 8.5l2.3 1.6M19 8.5l-2.3 1.6", "M5 18.5l2.3-1.6M19 18.5l-2.3-1.6"],
  // A warning sign: on a danger list Moat couldn't name.
  danger: ["M12 3.5l9.5 16.5h-19z", "M12 10v4.5", "M12 17.2v.01"],
  // A circle with a line through it: an ad page, or a site on a block list.
  blocked: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M5.7 5.7l12.6 12.6"],
  // A shield with a tick: protection is on.
  shieldOk: ["M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z", "M8.8 12.2l2.3 2.3 4.3-4.6"],
  // Crosshairs: trackers.
  target: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z", "M12 11.9v.2"],
  // A globe: sites.
  globe: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M3 12h18", "M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"],
  // A shield: security.
  shield: ["M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"],
  // A sparkle: the guided review.
  sparkle: ["M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z", "M19 3v3M17.5 4.5h3"],
  // Pause bars, an eye struck through, a tick in a circle: Exceptions.
  pause: ["M9 5v14M15 5v14"],
  hidden: ["M3 3l18 18", "M10.6 10.6a2 2 0 0 0 2.8 2.8", "M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.5 9.5 7a13 13 0 0 1-2.6 3.9", "M6.6 6.6C4.5 8 3.1 10 2.5 12c1 2.5 4.5 7 9.5 7 1.6 0 3-.4 4.3-1"],
  allowed: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M8 12.5l2.7 2.7L16 9.8"],
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function buildGlyph(doc: Document, name: GlyphName): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of GLYPHS[name]) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** A tile with a glyph: blue, or red for danger. */
export function buildGlyphTile(doc: Document, name: GlyphName, className = "glyph-tile"): HTMLElement {
  const tile = doc.createElement("span");
  tile.className = className;
  tile.setAttribute("aria-hidden", "true");
  tile.append(buildGlyph(doc, name));
  return tile;
}

/** Which glyph a stopped page gets, from the list that stopped it. */
export function stopGlyph(list: string | undefined, kind: string | undefined): GlyphName {
  if (kind === "ads" || kind === "custom" || kind === "policy") return "blocked";
  if (list === "phishing-urls") return "phishing";
  if (list === "scam") return "scam";
  if (list === "malicious-urls" || list === "badware") return "malware";
  return "danger";
}

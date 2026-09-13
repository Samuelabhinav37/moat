// Pure color-contrast math, no DOM -- used by findInvisibleText.ts (which
// does the actual DOM walking) to catch the exact class of bug found in
// v0.11.89: text whose color and background happened to resolve to nearly
// the same value, rendering as functionally invisible. Not a general WCAG
// linter -- see CONTRAST_FLOOR's own comment for why the threshold is much
// looser than the accessibility-standard 4.5:1.

/** Parses a getComputedStyle()-shaped color string ("rgb(r, g, b)" or
 * "rgba(r, g, b, a)") into its channels. Returns null for anything else --
 * in particular, an *unresolved* "var(--x)" string (see resolveVarColor
 * below for why that shows up at all) or "transparent"/"rgba(0, 0, 0, 0)". */
export function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value.trim());
  if (!match) return null;
  const [, r, g, b, a] = match;
  return { r: Number(r), g: Number(g), b: Number(b), a: a === undefined ? 1 : Number(a) };
}

/** True for a color this codebase's CSS would treat as "no background here,
 * keep looking up the tree" -- fully transparent, or the parse failed. */
export function isTransparent(value: string): boolean {
  const parsed = parseColor(value);
  return parsed === null || parsed.a === 0;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two colors, 1 (identical) to 21 (black/white). */
export function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  const l1 = relativeLuminance(a.r, a.g, a.b);
  const l2 = relativeLuminance(b.r, b.g, b.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Below this, text reads as practically invisible against its background --
 * this is deliberately far looser than WCAG AA's 4.5:1 (or even AA-large's
 * 3:1). This isn't a general accessibility audit (that would flag plenty of
 * legitimate, legible muted/secondary text already in the product and turn
 * this into noisy work nobody asked for); it exists only to catch the exact
 * failure mode found in v0.11.89 -- a near-white-on-white color-token
 * mismatch, which measures at roughly 1.05:1. 2:1 catches that class with
 * real margin while staying quiet on every real muted-text choice today. */
export const INVISIBLE_TEXT_CONTRAST_FLOOR = 2;

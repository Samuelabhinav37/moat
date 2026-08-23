// Pulled out of feedAdScanner.ts (which walks the live DOM and touches
// storage) so the actual matching logic is importable in tests without a
// browser environment -- same pattern as generateSelector.ts.

// Exact-match only (after trim + lowercase) -- deliberately not a substring
// test, so prose that merely mentions one of these words doesn't match.
const AD_LABELS = new Set(["sponsored", "ad", "paid partnership"]);

export function isAdLabel(text: string): boolean {
  return AD_LABELS.has(text.trim().toLowerCase());
}

// The nearest ancestor considered a "whole post/card" worth hiding, tried
// in order. article covers Instagram's feed post/reel wrapper; the rest
// cover YouTube's various in-feed card renderers.
export const AD_CONTAINER_SELECTOR = [
  "article",
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-reel-item-renderer",
  "ytd-rich-shelf-renderer",
  "ytd-in-feed-ad-layout-renderer",
].join(",");

/** The element to hide for a label found on `labelHost`, or null if no
 * known "whole post/card" ancestor exists (nothing gets hidden in that
 * case, rather than guessing at the wrong container). */
export function findAdContainer(labelHost: Element): Element | null {
  return labelHost.closest(AD_CONTAINER_SELECTOR);
}

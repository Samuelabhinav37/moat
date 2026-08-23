// Pulled out of feedAdScanner.ts (which walks the live DOM and touches
// storage) so the actual matching logic is importable in tests without a
// browser environment -- same pattern as generateSelector.ts.

const AD_LABELS = new Set(["sponsored", "ad", "paid partnership", "promoted"]);

// Feeds commonly render the label sharing one text node with adjacent
// metadata -- e.g. Instagram's post header is "Sponsored · 2h" the same way
// an organic post's is "username · 2h", both as a single text node. Split
// on the separators these sites actually use between metadata segments and
// check each segment on its own, rather than only the whole node -- still
// an exact match per segment, so this doesn't degrade into a substring
// test. "Ad-free" stays rejected: with no separator present, the whole
// string is the only segment, and it isn't a match.
const SEGMENT_SEPARATOR = /[•·|]| - /;

function normalize(text: string): string {
  return text.replace(/ /g, " ").trim().toLowerCase();
}

export function isAdLabel(text: string): boolean {
  return text
    .split(SEGMENT_SEPARATOR)
    .map(normalize)
    .some((segment) => AD_LABELS.has(segment));
}

// The nearest ancestor considered a "whole post/card" worth hiding, tried
// in order. article covers Instagram's feed post/reel wrapper; the
// ytd-* renderers cover YouTube's various in-feed card types; [data-urn]
// and feed-shared-update-v2 cover LinkedIn (data-urn is the more reliable
// of the two -- LinkedIn has migrated most of its class names to hashed
// CSS modules, per the same class-obfuscation pattern Instagram uses).
export const AD_CONTAINER_SELECTOR = [
  "article",
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-reel-item-renderer",
  "ytd-rich-shelf-renderer",
  "ytd-in-feed-ad-layout-renderer",
  "[data-urn]",
  ".feed-shared-update-v2",
].join(",");

/** The element to hide for a label found on `labelHost`, or null if no
 * known "whole post/card" ancestor exists (nothing gets hidden in that
 * case, rather than guessing at the wrong container). */
export function findAdContainer(labelHost: Element): Element | null {
  return labelHost.closest(AD_CONTAINER_SELECTOR);
}

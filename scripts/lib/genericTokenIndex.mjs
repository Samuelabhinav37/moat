// Build-time: partitions the flat list of generic (no-hostname) cosmetic
// selectors into
//   genericByHash: Record<tokenHash, selector[]>  -- filed under the hash of
//                  the selector's anchoring class/id token
//   genericHigh:   selector[]                      -- no usable anchor token,
//                  so the runtime surveyor always injects these
//
// The runtime surveyor (src/content/cosmeticSurveyor.ts) collects the
// class/id tokens actually present in a page's DOM, hashes each with the
// identical tokenHash, and injects only genericByHash[hash] for hashes it
// saw -- plus genericHigh unconditionally. Mis-extracting an anchor only
// ever costs one selector its fast path (it lands under a hash the page
// never queries, i.e. under-hidden); the lists refresh weekly and the
// build asserts nothing is dropped, so this stays a best-effort heuristic
// rather than a full CSS parser. Mirrors uBlock Origin's generic-cosmetic
// bucketing by low-level token.

import { tokenHash } from "./tokenHash.mjs";

// A plain `.class` / `#id` token: the `.`/`#` prefix, an optional leading
// hyphen, a non-digit start (ASCII letter, `_`, or any non-ASCII code
// point >= U+00A0), then letters/digits/`_`/`-`/non-ASCII. CSS escapes
// (`.ad\:box`) aren't decoded -- such a selector just yields a shorter
// token or none and falls to genericHigh, which is safe.
const CLASS_OR_ID_TOKEN = /[.#]-?[A-Za-z_\u00A0-\uFFFF][\w\u00A0-\uFFFF-]*/g;

// Sentinel that replaces a stripped `[...]` / `(...)` group: keeps the
// compound it belonged to non-empty (so `.a [data-x]` still reads as two
// compounds, the right-most attribute-only) while never matching a
// combinator or CLASS_OR_ID_TOKEN.
const GROUP_MASK = "\u0001";

/** Replace the contents of every `[...]` and `(...)` group (and the brackets
 * themselves) with GROUP_MASK, so combinator/token scanning only sees the
 * "bare" part of a compound selector -- an attribute selector or a
 * `:has(...)`/`:not(...)` argument is never a usable anchor. Non-nested is
 * close enough; nested parens in a generic selector are vanishingly rare
 * and fall through to genericHigh, which is safe. */
function maskGroups(selector) {
  let out = "";
  let paren = 0;
  let bracket = 0;
  for (const ch of selector) {
    if (ch === "(") {
      if (paren === 0 && bracket === 0) out += GROUP_MASK;
      paren += 1;
    } else if (ch === ")") {
      paren = Math.max(0, paren - 1);
    } else if (ch === "[") {
      if (paren === 0 && bracket === 0) out += GROUP_MASK;
      bracket += 1;
    } else if (ch === "]") {
      bracket = Math.max(0, bracket - 1);
    } else if (paren === 0 && bracket === 0) {
      out += ch;
    }
  }
  return out;
}

/** Split a selector on top-level commas only (a comma inside `:has(a, b)` or
 * `[x=","]` is not a list separator). */
export function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * The anchoring class/id token of a single (comma-free) selector: the last
 * `.class` / `#id` token of its right-most compound. Returns null when the
 * right-most compound has no plain class/id token (a bare tag, `*`,
 * attribute-only, or a pseudo-only compound) -- those go to genericHigh.
 */
export function extractAnchorToken(selector) {
  const bare = maskGroups(selector).trim();
  if (!bare) return null;
  // Right-most compound: split on descendant/child/sibling combinators.
  const compounds = bare.split(/[\s>+~]+/).filter(Boolean);
  const rightmost = compounds[compounds.length - 1];
  if (!rightmost) return null;
  const tokens = rightmost.match(CLASS_OR_ID_TOKEN);
  if (!tokens || tokens.length === 0) return null;
  return tokens[tokens.length - 1].slice(1);
}

/**
 * @param {string[]} genericSelectors  unique, sorted generic selectors
 * @returns {{ genericByHash: Record<string, string[]>, genericHigh: string[] }}
 */
export function partitionGenericSelectors(genericSelectors) {
  /** @type {Record<string, string[]>} */
  const genericByHash = {};
  const genericHigh = [];

  for (const selector of genericSelectors) {
    const parts = splitSelectorList(selector);
    // A selector list is only fast-pathable if *every* part has an anchor --
    // otherwise one un-anchored part would be silently dropped.
    const anchors = parts.map(extractAnchorToken);
    if (parts.length === 0 || anchors.some((a) => a === null)) {
      genericHigh.push(selector);
      continue;
    }
    // File the whole selector under each part's anchor hash, deduped: the
    // surveyor injects the selector once any one of its parts' tokens is seen.
    const hashes = new Set(anchors.map((a) => tokenHash(a)));
    for (const hash of hashes) {
      (genericByHash[hash] ??= []).push(selector);
    }
  }

  for (const hash of Object.keys(genericByHash)) {
    genericByHash[hash].sort();
  }
  genericHigh.sort();

  return { genericByHash, genericHigh };
}

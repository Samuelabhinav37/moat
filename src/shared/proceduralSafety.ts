// Shared safety checks for procedural (extended-selector) cosmetic rules --
// the CSS prefix and each task argument. Build time
// (scripts/lib/parseProceduralSelector.mjs) and runtime
// (src/content/proceduralCosmetic.ts) must agree, so this has a
// byte-identical .mjs twin at scripts/lib/proceduralSafety.mjs, parity-checked
// by scripts/lib/proceduralSafety.test.mjs -- same discipline as
// src/shared/domainBucket.ts / tokenHash.ts.
//
// The rules come from build-time-vendored, CSS-parser-validated filter lists,
// the same trust root as every plain selector Moat already injects; these
// caps are defence-in-depth and a bound on pathological evaluation cost
// (a giant XPath over a big DOM), not the primary boundary.

// No { } < ` in a CSS *selector* -- a "}" could close the injected block
// early. Procedural prefixes and :upward()/closest() selectors get this.
const SELECTOR_DISALLOWED = /[{}<`]/;
// Task string args (:has-text, :xpath, :matches-css value) are never emitted
// into CSS, only compared / passed to RegExp / document.evaluate -- still
// reject the angle bracket and backtick, allow everything else.
const ARG_DISALLOWED = /[<`]/;

const MAX_PREFIX_LEN = 300;
const MAX_TEXT_ARG_LEN = 500;
const MAX_XPATH_LEN = 1000;
const MAX_UPWARD = 256;
const MAX_TEXT_LENGTH = 100_000;

export function isSafeProceduralPrefix(prefix: string): boolean {
  return prefix.length > 0 && prefix.length <= MAX_PREFIX_LEN && !SELECTOR_DISALLOWED.test(prefix);
}

// A task tuple: ["op", ...args]. Kept loose (string[] | (string|number)[])
// so both the .ts and .mjs sides can pass their own array types.
export function isSafeProceduralTask(task: ReadonlyArray<string | number>): boolean {
  const [op, a, b] = task;
  switch (op) {
    case "has-text":
      return typeof a === "string" && a.length > 0 && a.length <= MAX_TEXT_ARG_LEN && !ARG_DISALLOWED.test(a);
    case "min-text-length":
      return typeof a === "number" && Number.isFinite(a) && a > 0 && a <= MAX_TEXT_LENGTH;
    case "upward":
      return typeof a === "number" && Number.isInteger(a) && a > 0 && a <= MAX_UPWARD;
    case "upward-sel":
      return typeof a === "string" && a.length > 0 && a.length <= MAX_PREFIX_LEN && !SELECTOR_DISALLOWED.test(a);
    case "matches-css":
      return (
        (a === "" || a === "before" || a === "after") &&
        typeof b === "string" &&
        b.includes(":") &&
        b.length <= MAX_TEXT_ARG_LEN &&
        !ARG_DISALLOWED.test(b)
      );
    case "xpath":
      return typeof a === "string" && a.length > 0 && a.length <= MAX_XPATH_LEN && !SELECTOR_DISALLOWED.test(a);
    default:
      return false;
  }
}

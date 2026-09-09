// Byte-for-byte twin of src/shared/proceduralSafety.ts (minus TS types) --
// the build-time half. scripts/lib/proceduralSafety.test.mjs cross-checks
// the two agree, same as domainBucket.mjs / tokenHash.mjs.
const SELECTOR_DISALLOWED = /[{}<`]/;
const ARG_DISALLOWED = /[<`]/;

const MAX_PREFIX_LEN = 300;
const MAX_TEXT_ARG_LEN = 500;
const MAX_XPATH_LEN = 1000;
const MAX_UPWARD = 256;
const MAX_TEXT_LENGTH = 100_000;

export function isSafeProceduralPrefix(prefix) {
  return prefix.length > 0 && prefix.length <= MAX_PREFIX_LEN && !SELECTOR_DISALLOWED.test(prefix);
}

export function isSafeProceduralTask(task) {
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

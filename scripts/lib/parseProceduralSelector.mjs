// Parses AdGuard/uBO "procedural" (extended-selector) cosmetic selectors --
// the ones a plain <style> can't express because they need a JS engine
// re-evaluating the live DOM: :has-text() / :contains(), :matches-css()
// (+ -before/-after), :xpath(), :upward(), :min-text-length(), :remove().
//
// Output shape (kept compact -- it ships in cosmetics-meta.json and is sent
// to the content script per navigation):
//   { s: cssPrefix, t: task[], r?: 1, x: originalSelector }
//     s  the plain-CSS prefix run through querySelectorAll first ("" = none,
//        e.g. a bare :xpath())
//     t  the task chain, each ["op", ...args]
//     r  present + truthy => remove the matched element instead of hiding it
//     x  the original selector text, for #@# exception matching at runtime
//
// task tuples:
//   ["has-text", "substr" | "/re/flags"]
//   ["min-text-length", n]
//   ["upward", n]                     n parentElement hops
//   ["upward-sel", "css"]             closest(css)
//   ["matches-css", "" | "before" | "after", "prop: valueOrRegex"]
//   ["xpath", "xpath expr"]
//
// Anything this can't parse cleanly returns null and the caller skips the
// rule (same as before this module existed). :style() and :matches-attr() /
// :matches-path() / :watch-attr() / :others() are intentionally not handled
// yet -- rarer, and each is its own can of worms.
import { isSafeProceduralPrefix, isSafeProceduralTask } from "./proceduralSafety.mjs";

const PSEUDO_NAMES = [
  "has-text",
  "contains",
  "matches-css",
  "matches-css-before",
  "matches-css-after",
  "xpath",
  "upward",
  "min-text-length",
  "remove",
];

/** True if `selector` uses any procedural pseudo this module handles. */
export function isProceduralSelector(selector) {
  return PSEUDO_NAMES.some((name) => selector.includes(`:${name}(`));
}

/** Index of the first top-level `:<name>(` for one of PSEUDO_NAMES, or -1.
 * "Top-level" = not inside an earlier pseudo's parentheses. */
function firstPseudoIndex(selector) {
  let depth = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) {
      const rest = selector.slice(i + 1);
      const name = PSEUDO_NAMES.find((n) => rest.startsWith(`${n}(`));
      if (name) return i;
    }
  }
  return -1;
}

/** From `selector` starting at a `:`, pull one `:name(arg)` (balanced
 * parens). Returns { name, arg, end } or null. */
function readPseudo(selector, start) {
  const open = selector.indexOf("(", start);
  if (open === -1) return null;
  const name = selector.slice(start + 1, open);
  let depth = 0;
  for (let i = open; i < selector.length; i += 1) {
    if (selector[i] === "(") depth += 1;
    else if (selector[i] === ")") {
      depth -= 1;
      if (depth === 0) return { name, arg: selector.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

function taskFor(name, arg) {
  const a = arg.trim();
  switch (name) {
    case "has-text":
    case "contains":
      return a ? ["has-text", a] : null;
    case "min-text-length": {
      const n = Number.parseInt(a, 10);
      return Number.isFinite(n) && n > 0 ? ["min-text-length", n] : null;
    }
    case "upward": {
      const n = Number.parseInt(a, 10);
      if (Number.isFinite(n) && n > 0 && String(n) === a) return ["upward", n];
      return a ? ["upward-sel", a] : null;
    }
    case "matches-css":
    case "matches-css-before":
    case "matches-css-after": {
      if (!a.includes(":")) return null;
      const pseudo = name === "matches-css" ? "" : name.slice("matches-css-".length);
      return ["matches-css", pseudo, a];
    }
    case "xpath":
      return a ? ["xpath", a] : null;
    default:
      return null;
  }
}

/**
 * Parse one procedural selector string into the compact rule shape, or null.
 * `originalSelector` is echoed back as `x` for runtime exception matching
 * (defaults to `selector` itself).
 */
export function parseProceduralSelector(selector, originalSelector = selector) {
  const trimmed = selector.trim();
  if (!trimmed || !isProceduralSelector(trimmed)) return null;
  // A leading "^" is uBO HTML filtering (##^script:has-text(...)) -- it
  // removes a node from the raw HTTP response body, which needs blocking
  // webRequest, not a DOM engine. Not something Moat does.
  if (trimmed.startsWith("^")) return null;

  const cut = firstPseudoIndex(trimmed);
  if (cut === -1) return null;
  const prefix = trimmed.slice(0, cut).trim();

  const tasks = [];
  let remove = false;
  let pos = cut;
  while (pos < trimmed.length) {
    if (trimmed[pos] !== ":") return null; // chain must be back-to-back pseudos
    const parsed = readPseudo(trimmed, pos);
    if (!parsed) return null;
    if (parsed.name === "remove") {
      if (parsed.arg.trim() !== "") return null;
      remove = true;
      pos = parsed.end;
      if (pos !== trimmed.length) return null; // :remove() is terminal
      break;
    }
    const task = taskFor(parsed.name, parsed.arg);
    if (!task || !isSafeProceduralTask(task)) return null;
    tasks.push(task);
    pos = parsed.end;
  }

  if (tasks.length === 0 && !remove) return null;
  // A bare :xpath() (no CSS prefix) is fine; otherwise the prefix must be a
  // real, safe CSS selector.
  if (prefix !== "" && !isSafeProceduralPrefix(prefix)) return null;

  const rule = { s: prefix, t: tasks, x: originalSelector };
  if (remove) rule.r = 1;
  return rule;
}

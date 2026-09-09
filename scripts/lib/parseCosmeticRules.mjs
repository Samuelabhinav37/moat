// Parses AdGuard/AdBlock Plus-style cosmetic filter lines into a structure
// a content script can apply -- mostly as plain CSS (cosmeticInject.ts),
// with a procedural side channel (proceduralCosmetic.ts) for the extended
// selectors.
//
import { isProceduralSelector, parseProceduralSelector } from "./parseProceduralSelector.mjs";
//
// We handle the standard element-hiding syntax:
//   ##selector                    generic, applies everywhere
//   domain1,domain2##selector     applies only on those domains (+ subdomains)
//   ~domain##selector             applies everywhere EXCEPT that domain
//   domain#@#selector             exception: never hide this on domain
// ...and CSS injection, which is still plain CSS a <style> tag can express,
// just with an author-supplied declaration instead of the implicit
// `{display:none!important}` every hide rule shares:
//   domain#$#selector { declaration }     inject this declaration on domain
//   domain#@$#selector                    exception: don't inject on domain
//     (the exception form is bare, matching #@#'s shape -- AdGuard/uBO don't
//     carry a declaration on the negation side either, since it's undoing
//     the *rule for this selector*, not asserting a different declaration.
//     Reuses the same exceptions map #@# already feeds, since both mean the
//     same thing: don't apply whatever rule targets this selector here.)
//
// Scriptlets (#%#) and HTML filters (#?# ... wait, #?# is procedural-hide;
// HTML filtering is $$ / $@$) execute / rewrite markup and are still
// skipped. Procedural (extended-selector) cosmetic rules -- :has-text,
// :matches-css, :xpath, :upward, :min-text-length, :remove -- ARE now
// handled, via parseProceduralSelector.mjs + src/content/proceduralCosmetic.ts
// (added alongside the uBO "Annoyances - others" cosmetic list, which uses
// them heavily; Moat's AdGuard lists barely do). Native :has() / :not() stay
// plain CSS. These extended pseudos still need a JS engine we don't have, so
// a rule using any of them is skipped, not mis-parsed:
const UNSUPPORTED_EXTENDED_MARKERS = [
  ":matches-attr(",
  ":matches-property(",
  ":matches-path(",
  ":nth-ancestor(",
  ":watch-attr(",
  ":others(",
  ":if(",
  ":if-not(",
  ":style(",
  "-abp-",
  "[-ext-",
  "+js(",
];

const INJECT_EXCEPTION_MARKER = "#@$#";
const INJECT_MARKER = "#$#";

// Fast substring blocklist for an injected declaration, same "known
// escape/execution vectors" posture as EXTENDED_SELECTOR_MARKERS and
// selectorSafety.ts's selector check -- applied here, at parse time, before
// the real jsdom structural validation (isValidDeclaration, injected into
// buildCosmeticIndex the same way isValidSelector already is) ever sees it.
// </style>/<style: can't break out of the wrapping <style> tag (textContent
// is used to set it, not innerHTML, but defense in depth costs nothing).
// backtick: no legitimate role in a CSS declaration. @import: would pull in
// a stylesheet from outside this build's own vendored/validated content.
// expression(: legacy IE CSS-expression code execution -- inert in any
// browser Moat supports, blocked anyway since it costs nothing to.
const DECLARATION_DISALLOWED = /<\/?style|`|@import|expression\(/i;
const MAX_DECLARATION_LENGTH = 2000;

export function isSafeCssDeclarationText(declaration) {
  return declaration.length > 0 && declaration.length <= MAX_DECLARATION_LENGTH && !DECLARATION_DISALLOWED.test(declaration);
}

/** Parses `domainsPart#$#selector { declaration }` or the bare exception
 * form `domainsPart#@$#selector`. Returns null for anything that isn't
 * exactly that shape, or whose selector/declaration fails the same
 * blocklist checks the plain hide-rule path applies. */
function parseCssInjectionLine(line, domainsPart, marker, body) {
  const isException = marker === INJECT_EXCEPTION_MARKER;
  let selector;
  let declaration = null;

  if (isException) {
    selector = body.trim();
  } else {
    const match = body.match(/^(.*?)\s*\{([\s\S]*)\}\s*$/);
    if (!match) return null;
    selector = match[1].trim();
    declaration = match[2].trim();
    if (!isSafeCssDeclarationText(declaration)) return null;
  }
  if (!selector) return null;
  for (const forbidden of UNSUPPORTED_EXTENDED_MARKERS) {
    if (selector.includes(forbidden)) return null;
  }
  // Injection rules with procedural selectors aren't supported (the runtime
  // injection path is plain CSS) -- skip rather than mis-parse.
  if (isProceduralSelector(selector)) return null;

  const domains = domainsPart
    ? domainsPart
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : [];

  return isException ? { isException: true, domains, selector } : { isException: false, domains, selector, declaration };
}

function splitDomains(domainsPart) {
  return domainsPart
    ? domainsPart
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : [];
}

/**
 * Parse one filter-list line. Returns null if it's not a cosmetic rule this
 * build understands (comments, network rules, scriptlets, HTML filters, and
 * still-unsupported extended pseudos all return null). Result shapes:
 *   { isException, domains, selector }                 plain hide / exception
 *   { isException:false, domains, selector, declaration }  CSS injection
 *   { isException:false, domains, selector, procedural }   procedural hide/remove
 *   { isException:true,  domains, selector }               procedural exception too
 * buildCosmeticIndex tells them apart by which extra field is present.
 */
export function parseCosmeticLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith("!") || line.startsWith("[")) return null;
  if (line.includes("#@%#") || line.includes("#%#")) return null;

  // uBO's procedural markers: #?# = procedural hide, #@?# = its exception.
  // (These are NOT HTML filtering -- that's $$/$@$ -- despite older comments
  // in this file. Check #@?# first: "#?#" is not a substring of it.)
  const procExcIndex = line.indexOf("#@?#");
  if (procExcIndex !== -1) {
    const selector = line.slice(procExcIndex + 4);
    return selector ? { isException: true, domains: splitDomains(line.slice(0, procExcIndex)), selector } : null;
  }
  const procIndex = line.indexOf("#?#");
  if (procIndex !== -1) {
    const selector = line.slice(procIndex + 3);
    const procedural = parseProceduralSelector(selector);
    return procedural
      ? { isException: false, domains: splitDomains(line.slice(0, procIndex)), selector, procedural }
      : null;
  }

  const injectExceptionIndex = line.indexOf(INJECT_EXCEPTION_MARKER);
  const injectIndex = line.indexOf(INJECT_MARKER);
  if (injectExceptionIndex !== -1) {
    return parseCssInjectionLine(line, line.slice(0, injectExceptionIndex), INJECT_EXCEPTION_MARKER, line.slice(injectExceptionIndex + INJECT_EXCEPTION_MARKER.length));
  }
  if (injectIndex !== -1) {
    return parseCssInjectionLine(line, line.slice(0, injectIndex), INJECT_MARKER, line.slice(injectIndex + INJECT_MARKER.length));
  }

  const exceptionIndex = line.indexOf("#@#");
  const hideIndex = line.indexOf("##");
  let marker;
  let isException;
  if (exceptionIndex !== -1 && (hideIndex === -1 || exceptionIndex < hideIndex)) {
    marker = "#@#";
    isException = true;
  } else if (hideIndex !== -1) {
    marker = "##";
    isException = false;
  } else {
    return null;
  }

  const markerIndex = line.indexOf(marker);
  const domainsPart = line.slice(0, markerIndex);
  const selector = line.slice(markerIndex + marker.length);
  if (!selector) return null;

  const domains = splitDomains(domainsPart);

  // A ## line can also carry procedural syntax (uBO writes both ## and #?#
  // for these). An exception (#@#) is matched by selector string, so it
  // needs no procedural parse.
  if (!isException && isProceduralSelector(selector)) {
    const procedural = parseProceduralSelector(selector);
    return procedural ? { isException: false, domains, selector, procedural } : null;
  }
  for (const forbidden of UNSUPPORTED_EXTENDED_MARKERS) {
    if (selector.includes(forbidden)) return null;
  }

  return { isException, domains, selector };
}

/**
 * Fold a list of raw filter-file contents into one cosmetic-rule index.
 * `isValidSelector` is injected (rather than importing a CSS engine here)
 * so this module has no DOM dependency of its own -- the real build script
 * validates with jsdom; tests can pass a trivial always-true stub.
 * `isValidDeclaration(selector, declaration)` is the same kind of injected
 * check for CSS-injection rules' declaration -- only called for rules that
 * actually carry one, so callers with no injection-syntax input (existing
 * tests included) can omit it entirely.
 */
export function buildCosmeticIndex(filterTexts, isValidSelector, isValidDeclaration) {
  const generic = new Set();
  const perDomain = new Map();
  const exceptions = new Map();
  // CSS-injection rules pair a selector with its own declaration, so they
  // can't share the plain Set<selector> shape above -- Map<selector,
  // declaration> instead (last-write-wins on a duplicate selector across
  // lists, the same way generic/perDomain Sets already dedupe identical
  // hide selectors, just with a value to keep this time).
  const injectGeneric = new Map();
  const injectPerDomain = new Map();
  // Procedural (extended-selector) rules -- a separate channel from the CSS
  // above. Keyed the same positives/negatives/exceptions way.
  const proceduralGeneric = [];
  const proceduralPerDomain = new Map();
  const proceduralGenericSeen = new Set();

  const addTo = (map, domain, selector) => {
    let set = map.get(domain);
    if (!set) {
      set = new Set();
      map.set(domain, set);
    }
    set.add(selector);
  };

  const addInjectTo = (map, domain, selector, declaration) => {
    let inner = map.get(domain);
    if (!inner) {
      inner = new Map();
      map.set(domain, inner);
    }
    inner.set(selector, declaration);
  };

  const addProceduralTo = (domain, rule) => {
    let list = proceduralPerDomain.get(domain);
    if (!list) {
      list = [];
      proceduralPerDomain.set(domain, list);
    }
    if (!list.some((r) => r.x === rule.x)) list.push(rule);
  };

  for (const text of filterTexts) {
    for (const line of text.split("\n")) {
      const rule = parseCosmeticLine(line);
      if (!rule) continue;

      // #@$# (bare exception) and #@# both mean "don't apply whatever rule
      // targets this selector here" -- parseCosmeticLine already returns
      // the identical shape for both (plain and procedural), so this one
      // branch handles all of them.
      if (rule.isException) {
        for (const domain of rule.domains) addTo(exceptions, domain.replace(/^~/, ""), rule.selector);
        continue;
      }

      if (rule.procedural) {
        // The CSS prefix (if any) must parse; the task chain was already
        // safety-checked in parseProceduralSelector.
        if (rule.procedural.s && !isValidSelector(rule.procedural.s)) continue;
        const positives = rule.domains.filter((d) => !d.startsWith("~"));
        const negatives = rule.domains.filter((d) => d.startsWith("~")).map((d) => d.slice(1));
        if (positives.length === 0) {
          if (!proceduralGenericSeen.has(rule.procedural.x)) {
            proceduralGenericSeen.add(rule.procedural.x);
            proceduralGeneric.push(rule.procedural);
          }
        } else {
          for (const domain of positives) addProceduralTo(domain, rule.procedural);
        }
        for (const domain of negatives) addTo(exceptions, domain, rule.selector);
        continue;
      }

      if (!isValidSelector(rule.selector)) continue;

      if (rule.declaration !== undefined) {
        if (!isValidDeclaration(rule.selector, rule.declaration)) continue;
        const positives = rule.domains.filter((d) => !d.startsWith("~"));
        const negatives = rule.domains.filter((d) => d.startsWith("~")).map((d) => d.slice(1));
        if (positives.length === 0) {
          injectGeneric.set(rule.selector, rule.declaration);
          for (const domain of negatives) addTo(exceptions, domain, rule.selector);
        } else {
          for (const domain of positives) addInjectTo(injectPerDomain, domain, rule.selector, rule.declaration);
          for (const domain of negatives) addTo(exceptions, domain, rule.selector);
        }
        continue;
      }

      const positives = rule.domains.filter((d) => !d.startsWith("~"));
      const negatives = rule.domains.filter((d) => d.startsWith("~")).map((d) => d.slice(1));

      if (positives.length === 0) {
        generic.add(rule.selector);
        for (const domain of negatives) addTo(exceptions, domain, rule.selector);
      } else {
        for (const domain of positives) addTo(perDomain, domain, rule.selector);
        for (const domain of negatives) addTo(exceptions, domain, rule.selector);
      }
    }
  }

  const toObject = (map) => Object.fromEntries([...map].map(([k, v]) => [k, [...v].sort()]));
  const sortedPairs = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const byOriginalSelector = (a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0);

  // The `x` (original selector text) on a procedural rule is only there for
  // #@# exception matching at runtime -- it roughly doubles each rule's JSON.
  // Keep it only on rules some exception actually names; drop it from the
  // rest. (Dedup already ran above, while every rule still had its `x`.)
  const exceptedSelectors = new Set();
  for (const set of exceptions.values()) for (const selector of set) exceptedSelectors.add(selector);
  const trimX = (rule) =>
    exceptedSelectors.has(rule.x)
      ? { s: rule.s, t: rule.t, x: rule.x, ...(rule.r ? { r: rule.r } : {}) }
      : { s: rule.s, t: rule.t, ...(rule.r ? { r: rule.r } : {}) };

  return {
    generic: [...generic].sort(),
    perDomain: toObject(perDomain),
    exceptions: toObject(exceptions),
    cssInjection: {
      generic: sortedPairs(injectGeneric),
      perDomain: Object.fromEntries([...injectPerDomain].map(([domain, inner]) => [domain, sortedPairs(inner)])),
    },
    procedural: {
      generic: [...proceduralGeneric].sort(byOriginalSelector).map(trimX),
      perDomain: Object.fromEntries(
        [...proceduralPerDomain].map(([domain, list]) => [domain, [...list].sort(byOriginalSelector).map(trimX)])
      ),
    },
  };
}

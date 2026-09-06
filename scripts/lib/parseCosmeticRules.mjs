// Parses AdGuard/AdBlock Plus-style cosmetic filter lines into a structure
// a content script can apply as plain CSS (see src/content/cosmeticFilter.ts).
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
// Deliberately NOT handled -- these aren't plain CSS, so a <style> tag
// can't express them, and scriptlets execute arbitrary-ish logic we don't
// want to run sight-unseen: scriptlets (#%#), HTML filters (#?#), and
// AdGuard/uBO extended pseudo-classes that need a JS matching engine
// (:contains, :matches-css, :xpath, :upward, :remove, +js(), etc.) -- the
// latter measured directly against Moat's actual bundled lists at 7 of
// 119,391 real cosmetic lines (0.0%), not worth a JS matching engine; see
// docs/design-notes.md's "Researched but not built yet" section. Rules
// using those are skipped, not mis-parsed. Native :has() is kept -- modern
// Chrome/Firefox support it as real CSS.
const EXTENDED_SELECTOR_MARKERS = [
  ":contains(",
  ":matches-css(",
  ":matches-css-before(",
  ":matches-css-after(",
  ":xpath(",
  ":upward(",
  ":remove(",
  ":matches-attr(",
  ":matches-property(",
  ":nth-ancestor(",
  ":if(",
  ":if-not(",
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
  for (const forbidden of EXTENDED_SELECTOR_MARKERS) {
    if (selector.includes(forbidden)) return null;
  }

  const domains = domainsPart
    ? domainsPart
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : [];

  return isException ? { isException: true, domains, selector } : { isException: false, domains, selector, declaration };
}

/**
 * Parse one filter-list line. Returns null if it's not a plain
 * element-hiding/exception or CSS-injection cosmetic rule (comments,
 * network rules, scriptlet/HTML-filter/extended-selector rules all return
 * null). An injection-rule result carries a `declaration` field; a plain
 * hide/exception result never does -- that presence/absence is how
 * buildCosmeticIndex tells the two apart, rather than a separate tag.
 */
export function parseCosmeticLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith("!") || line.startsWith("[")) return null;
  if (line.includes("#@%#") || line.includes("#%#")) return null;
  if (line.includes("#@?#") || line.includes("#?#")) return null;

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

  for (const forbidden of EXTENDED_SELECTOR_MARKERS) {
    if (selector.includes(forbidden)) return null;
  }

  const domains = domainsPart
    ? domainsPart
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : [];

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

  for (const text of filterTexts) {
    for (const line of text.split("\n")) {
      const rule = parseCosmeticLine(line);
      if (!rule || !isValidSelector(rule.selector)) continue;

      // #@$# (bare exception) and #@# both mean "don't apply whatever rule
      // targets this selector here" -- parseCosmeticLine already returns
      // the identical shape for both, so this one branch handles both.
      if (rule.isException) {
        for (const domain of rule.domains) addTo(exceptions, domain.replace(/^~/, ""), rule.selector);
        continue;
      }

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

  return {
    generic: [...generic].sort(),
    perDomain: toObject(perDomain),
    exceptions: toObject(exceptions),
    cssInjection: {
      generic: sortedPairs(injectGeneric),
      perDomain: Object.fromEntries([...injectPerDomain].map(([domain, inner]) => [domain, sortedPairs(inner)])),
    },
  };
}

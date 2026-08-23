// Parses AdGuard/AdBlock Plus-style cosmetic filter lines into a structure
// a content script can apply as plain CSS (see src/content/cosmeticFilter.ts).
//
// We only handle the standard element-hiding syntax:
//   ##selector                    generic, applies everywhere
//   domain1,domain2##selector     applies only on those domains (+ subdomains)
//   ~domain##selector             applies everywhere EXCEPT that domain
//   domain#@#selector             exception: never hide this on domain
//
// Deliberately NOT handled -- these aren't plain CSS, so a <style> tag
// can't express them, and scriptlets execute arbitrary-ish logic we don't
// want to run sight-unseen: CSS injection (#$#), scriptlets (#%#), and
// AdGuard/uBO extended pseudo-classes that need a JS matching engine
// (:contains, :matches-css, :xpath, :upward, :remove, +js(), etc.). Rules
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

/**
 * Parse one filter-list line. Returns null if it's not a plain
 * element-hiding/exception cosmetic rule (comments, network rules,
 * CSS-injection/scriptlet/extended-selector rules all return null).
 */
export function parseCosmeticLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith("!") || line.startsWith("[")) return null;
  if (line.includes("#@$#") || line.includes("#$#")) return null;
  if (line.includes("#@%#") || line.includes("#%#")) return null;
  if (line.includes("#@?#") || line.includes("#?#")) return null;

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
 */
export function buildCosmeticIndex(filterTexts, isValidSelector) {
  const generic = new Set();
  const perDomain = new Map();
  const exceptions = new Map();

  const addTo = (map, domain, selector) => {
    let set = map.get(domain);
    if (!set) {
      set = new Set();
      map.set(domain, set);
    }
    set.add(selector);
  };

  for (const text of filterTexts) {
    for (const line of text.split("\n")) {
      const rule = parseCosmeticLine(line);
      if (!rule || !isValidSelector(rule.selector)) continue;

      if (rule.isException) {
        for (const domain of rule.domains) addTo(exceptions, domain.replace(/^~/, ""), rule.selector);
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

  return {
    generic: [...generic].sort(),
    perDomain: toObject(perDomain),
    exceptions: toObject(exceptions),
  };
}

// What consentRejector.ts checks before loading the full Consent-O-Matic rules
// (rules/dnr/consent-rules.json, about 140 KB, fetched and parsed on every
// page until 0.11.283). A platform's rules only apply when its present
// matcher finds its target, so "some target selector matches" is a cheap,
// exact pre-check: no target on the page, no platform to reject, and the
// heuristic fallback runs without the rules. Inlined into
// consent-rejector.js at build time (scripts/build.mjs).
//
// Left out: targets only matched inside frames (iframeFilter: true), since
// the rejector runs in the top frame only.

function matchersOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * @param {object} ruleSet consent-rules.json: platform name -> config.
 * @returns {{ selectors: string[], texts: [string, string[]][] }} target
 *   selectors, and [selector, texts] for targets that also need text.
 */
export function buildConsentPresence(ruleSet) {
  const selectors = new Set();
  const texts = [];
  for (const [name, config] of Object.entries(ruleSet)) {
    if (name === "$schema" || typeof config !== "object" || config === null) continue;
    for (const detector of config.detectors ?? []) {
      for (const matcher of matchersOf(detector.presentMatcher)) {
        const target = matcher?.target;
        if (matcher?.type !== "css" || typeof target?.selector !== "string" || target.iframeFilter === true) continue;
        if (target.textFilter != null) texts.push([target.selector, [].concat(target.textFilter)]);
        else selectors.add(target.selector);
      }
    }
  }
  return { selectors: [...selectors].sort(), texts };
}

/**
 * Matcher evaluation, ported from Consent-O-Matic's Matcher.js
 * (https://github.com/cavi-au/Consent-O-Matic/blob/master/Extension/Matcher.js,
 * MIT-licensed), minus the debug-highlight (`.debug()`) machinery -- pure
 * UI chrome for their own extension's dev tooling, not relevant here.
 *
 * Two deliberate fail-safe deviations from the original: CheckboxMatcher
 * and OnOffMatcher throw upstream when their target(s) can't be resolved
 * unambiguously (no checkbox found; both or neither of on/off found).
 * Aborting a whole method over one missing element on a slightly different
 * page variant is worse than just reporting "not enabled" and moving on --
 * see each function's comment.
 */
import { find, type FindContext } from "./tools";
import type { CheckboxMatcherConfig, CssMatcherConfig, MatcherConfig, OnOffMatcherConfig, UrlMatcherConfig } from "./types";

function matchesCss(config: CssMatcherConfig, ctx: FindContext): boolean {
  return find(config, ctx, false).target !== null;
}

function matchesCheckbox(config: CheckboxMatcherConfig, ctx: FindContext): boolean {
  const target = find(config, ctx, false).target;
  if (target === null || !(target instanceof HTMLInputElement)) return false; // fail safe, not throw
  return config.negated ? !target.checked : target.checked;
}

function matchesOnOff(config: OnOffMatcherConfig, ctx: FindContext): boolean {
  const on = find(config.onMatcher, ctx, false).target !== null;
  const off = find(config.offMatcher, ctx, false).target !== null;
  if (on === off) return false; // ambiguous (both or neither found) -- fail safe, not throw
  return on;
}

function matchesUrl(config: UrlMatcherConfig, href: string): boolean {
  const urls = Array.isArray(config.url) ? config.url : [config.url];
  let matched: boolean;
  if (config.regexp) {
    matched = urls.some((pattern) => new RegExp(pattern).exec(href) !== null);
  } else {
    matched = urls.some((needle) => href.includes(needle));
  }
  return config.negated ? !matched : matched;
}

export function matches(config: MatcherConfig, ctx: FindContext, href: string = location.href): boolean {
  switch (config.type) {
    case "css":
      return matchesCss(config, ctx);
    case "checkbox":
      return matchesCheckbox(config, ctx);
    case "onoff":
      return matchesOnOff(config, ctx);
    case "url":
      return matchesUrl(config, href);
  }
}

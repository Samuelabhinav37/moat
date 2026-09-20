// Pure parser for a pasted/uploaded Adblock-Plus-syntax filter list (the
// format uBlock Origin's "My filters" tab and AdGuard's "User rules" both
// export as plain text) -- kept free of any webextension-polyfill import,
// same convention as usageStatsState.ts/filterGroupState.ts, so it's
// testable without a browser extension context.
//
// Deliberately conservative, same "never wrong in what it keeps" posture as
// scripts/update-filters.mjs's oisd ingestion (OISD_LINE_PATTERN): only the
// three rule shapes Moat's own Settings actually has a place for are
// recognized. Everything else -- generic no-domain `##selector` (Moat's
// custom rules are always per-site, there's no "hide everywhere" concept to
// map it to), regex filters, `$`-modifier filters, scriptlet rules
// (`##+js(...)`), cosmetic exceptions (`#@#`) -- is silently skipped and
// counted, never guessed at.
import { isSafeCosmeticSelector } from "./selectorSafety";
import { MAX_ARRAY_LENGTH, MAX_RECORD_KEYS, MAX_STRING_LENGTH } from "./importBounds";

export interface ParsedFilterImport {
  blockedDomains: string[];
  allowedDomains: string[];
  cosmeticRules: Record<string, string[]>;
  skippedLines: number;
}

const BLOCK_PATTERN = /^\|\|([a-z0-9.-]+)\^$/i;
const ALLOW_PATTERN = /^@@\|\|([a-z0-9.-]+)\^$/i;
// domain(s)##selector -- the domain part may be a comma-separated list
// ("d1,d2##.ad"); a leading "~" (uBlock's per-domain exception marker) or an
// empty domain part (generic, no-domain rule) is rejected below rather than
// matched here, since neither maps to anything Moat's Settings has.
const COSMETIC_PATTERN = /^([a-z0-9.,-]+)##(.+)$/i;
const DOMAIN_PATTERN = /^[a-z0-9.-]+$/i;

export function parseFilterListImport(text: string): ParsedFilterImport {
  const blockedDomains = new Set<string>();
  const allowedDomains = new Set<string>();
  // A Map, not a plain object: a hostname of "constructor" (a plausible bare
  // LAN/intranet hostname) previously collided with the inherited
  // Object.prototype member of that name -- `cosmeticRules["constructor"]`
  // resolved to the Object constructor function (truthy, so `??=` never
  // reassigned it), and `.add()` on that threw, crashing the entire import
  // with zero user feedback. A Map has no inherited keys, so no string can
  // ever collide with one.
  const cosmeticRules = new Map<string, Set<string>>();
  let skippedLines = 0;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Comments ("!...") and list headers ("[Adblock Plus 2.0]") are normal,
    // expected content in a real export -- not a failed match, so they're
    // dropped before the line-count cap and never counted as skipped.
    .filter((line) => !line.startsWith("!") && !line.startsWith("["))
    .slice(0, MAX_ARRAY_LENGTH);

  for (const line of lines) {
    const allowMatch = ALLOW_PATTERN.exec(line);
    if (allowMatch && allowMatch[1]!.length <= MAX_STRING_LENGTH) {
      allowedDomains.add(allowMatch[1]!.toLowerCase());
      continue;
    }

    const blockMatch = BLOCK_PATTERN.exec(line);
    if (blockMatch && blockMatch[1]!.length <= MAX_STRING_LENGTH) {
      blockedDomains.add(blockMatch[1]!.toLowerCase());
      continue;
    }
    // BLOCK_PATTERN/ALLOW_PATTERN's character class has no length bound of
    // its own -- a real hostname is nowhere near MAX_STRING_LENGTH, so a
    // match that's rejected here only for being oversized falls through to
    // the generic "skipped" counter below rather than being silently
    // dropped as an unmatched line.
    if (allowMatch || blockMatch) {
      skippedLines++;
      continue;
    }

    const cosmeticMatch = COSMETIC_PATTERN.exec(line);
    if (cosmeticMatch) {
      const domainsPart = cosmeticMatch[1]!;
      const selector = cosmeticMatch[2]!.trim();
      const domains = domainsPart
        .split(",")
        // A single line's comma-separated domain list is otherwise
        // unbounded by the line-count cap above -- "d1,d2,...,d200000##.ad"
        // is one line but 200,000 domains. Capped defensively even though
        // MAX_RECORD_KEYS below is the real backstop, so one pathological
        // line can't dominate the whole parse.
        .slice(0, MAX_RECORD_KEYS)
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0 && d.length <= MAX_STRING_LENGTH && !d.startsWith("~") && DOMAIN_PATTERN.test(d));
      // `##` is also uBlock/AdGuard's separator for scriptlet injection
      // (`##+js(...)`) and HTML filtering (`##^script:has-text(...)`) --
      // neither is a CSS selector, but neither contains the {}<` characters
      // isSafeCosmeticSelector rejects, so both would otherwise be saved
      // as if they were a real (inert, no-op) hide rule instead of being
      // reported as unsupported syntax.
      const looksLikeScriptletOrHtmlFilter = selector.startsWith("+js(") || selector.startsWith("^");
      if (
        domains.length === 0 ||
        selector.length > MAX_STRING_LENGTH ||
        looksLikeScriptletOrHtmlFilter ||
        !isSafeCosmeticSelector(selector)
      ) {
        skippedLines++;
        continue;
      }
      for (const domain of domains) {
        // A hard cap on distinct hostnames, not just lines: the per-line cap
        // above bounds one line, but many lines each introducing a few new
        // hostnames could still add up unboundedly otherwise.
        if (!cosmeticRules.has(domain) && cosmeticRules.size >= MAX_RECORD_KEYS) continue;
        const selectors = cosmeticRules.get(domain) ?? new Set<string>();
        cosmeticRules.set(domain, selectors);
        selectors.add(selector);
      }
      continue;
    }

    skippedLines++;
  }

  return {
    blockedDomains: [...blockedDomains],
    allowedDomains: [...allowedDomains],
    cosmeticRules: Object.fromEntries([...cosmeticRules].map(([hostname, selectors]) => [hostname, [...selectors]])),
    skippedLines,
  };
}

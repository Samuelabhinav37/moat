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
import { MAX_ARRAY_LENGTH } from "./importBounds";

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
  const cosmeticRules: Record<string, Set<string>> = {};
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
    if (allowMatch) {
      allowedDomains.add(allowMatch[1]!.toLowerCase());
      continue;
    }

    const blockMatch = BLOCK_PATTERN.exec(line);
    if (blockMatch) {
      blockedDomains.add(blockMatch[1]!.toLowerCase());
      continue;
    }

    const cosmeticMatch = COSMETIC_PATTERN.exec(line);
    if (cosmeticMatch) {
      const domainsPart = cosmeticMatch[1]!;
      const selector = cosmeticMatch[2]!.trim();
      const domains = domainsPart
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0 && !d.startsWith("~") && DOMAIN_PATTERN.test(d));
      // `##` is also uBlock/AdGuard's separator for scriptlet injection
      // (`##+js(...)`) and HTML filtering (`##^script:has-text(...)`) --
      // neither is a CSS selector, but neither contains the {}<` characters
      // isSafeCosmeticSelector rejects, so both would otherwise be saved
      // as if they were a real (inert, no-op) hide rule instead of being
      // reported as unsupported syntax.
      const looksLikeScriptletOrHtmlFilter = selector.startsWith("+js(") || selector.startsWith("^");
      if (domains.length === 0 || looksLikeScriptletOrHtmlFilter || !isSafeCosmeticSelector(selector)) {
        skippedLines++;
        continue;
      }
      for (const domain of domains) {
        (cosmeticRules[domain] ??= new Set()).add(selector);
      }
      continue;
    }

    skippedLines++;
  }

  return {
    blockedDomains: [...blockedDomains],
    allowedDomains: [...allowedDomains],
    cosmeticRules: Object.fromEntries(Object.entries(cosmeticRules).map(([hostname, selectors]) => [hostname, [...selectors]])),
    skippedLines,
  };
}

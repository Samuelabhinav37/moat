// Pure DOM-matching logic for the search-slop filter -- deliberately has NO
// "webextension-polyfill" import (that throws immediately outside a real
// extension context, same reason adCollapse.ts stays pure and lets
// cosmeticFilter.ts own the browser-API wiring) so this file can be
// unit-tested directly. See searchSlopFilterEntry.ts for the actual content-
// script entry point (settings gate, domain-list fetch, run scheduling).
//
// This collapses Google/Bing/DuckDuckGo organic results whose link host
// matches a curated low-quality/content-farm list. Not a verified "AI slop"
// signal (no reliable free dataset exists for that), so it carries real
// false-positive risk the way a fixed ad-network list doesn't -- see
// rules/seo-spam-domains.json for the (deliberately small, conservative)
// seed list. Better to under-list than falsely flag a legitimate small site.
//
// On-device LLM classification of ambiguous results (Chrome's LanguageModel
// Prompt API, same feature-detect/hardware-gate/graceful-degrade pattern
// Cluster's aiDigest.ts already uses) is real future work, not built here --
// this ships only the deterministic curated-domain layer.
//
// Exact result-page selectors are a live-test risk: Google/Bing/DuckDuckGo
// change their result markup without notice. Live-verified against real
// results pages on all three (2026-09) -- that pass found and fixed the
// engine configs picking the wrong anchor inside a multi-link result card
// (see EngineConfig's own comments on linkSelectors/citeSelector for the
// specifics), which had been shipping as a silent no-op on at least
// DuckDuckGo and Bing before this. Still best-effort and fails closed (no
// matches found just means no filtering, never breaks the page) against
// whatever these three sites' markup looks like next time they change it.
import { matchesDomainOrSubdomain } from "../shared/domainChain";

const HIDDEN_ATTR = "data-moat-slop-hidden";
const STYLE_ID = "moat-search-slop-style";
const BANNER_ID = "moat-search-slop-banner";

interface EngineConfig {
  /** Each matched element is one organic result "card" to evaluate. */
  resultSelector: string;
  /** The result's own title/link, tried in order -- the FIRST selector
   * that matches anything inside the card wins, full stop. This is
   * deliberately an ordered array evaluated one at a time, not a single
   * comma-separated selector string: `el.querySelector("A, B, C")` returns
   * whichever of A/B/C's matches comes first in *document order*, not
   * whichever alternative is listed first. A card that has both a highly
   * specific title anchor AND a more generic one (a favicon link, a "more
   * from this site" pill, a site-search shortcut) earlier in the DOM would
   * silently pick the wrong one -- confirmed live on both Google (an
   * internal google.com link ahead of the real title anchor in some cards)
   * and DuckDuckGo (a same-page "site:" refinement link ahead of the real
   * result-title-a) before this was split into an explicit fallback chain.
   */
  linkSelectors: readonly string[];
  /** Falls back to parsing the destination host out of this element's
   * display text when no href resolves to an external domain. Needed on
   * Bing specifically: EVERY result anchor there is wrapped in a
   * same-origin click-tracking redirect (resolves to bing.com, not the
   * result's actual destination) -- confirmed live, the real domain is
   * only ever exposed as the human-readable text of the citation element
   * (e.g. "RTINGS.com"), never as a plain href on the page at all. */
  citeSelector?: string;
  /** Where to insert the "N results hidden" banner. */
  bannerAnchorSelector: string;
}

const ENGINES: Record<string, EngineConfig> = {
  "www.google.com": {
    resultSelector: "#search .g, #rso > div",
    // Google's title is the anchor wrapping the visible <h3> heading --
    // confirmed live to correctly pick the result's own link even in
    // cards that also contain an earlier, same-origin google.com anchor
    // (a thumbnail/favicon link). Falls back to the first anchor at all
    // for card types with no <h3> (rich results, carousels) -- narrower
    // coverage there, but no worse than before this fix.
    linkSelectors: ["a:has(h3)", "a[href]"],
    citeSelector: "cite",
    bannerAnchorSelector: "#search, #rso",
  },
  "www.bing.com": {
    resultSelector: "li.b_algo",
    linkSelectors: ["h2 a[href]", "a[href]"],
    citeSelector: "cite, .b_attribution, .tptt",
    bannerAnchorSelector: "#b_content, #b_results",
  },
  "duckduckgo.com": {
    resultSelector: '[data-testid="result"], .result',
    linkSelectors: ['[data-testid="result-title-a"]', ".result__a", "a[href]"],
    bannerAnchorSelector: '[data-testid="mainline"], #links',
  },
};

/** hostname of an absolute or root-relative URL string, lowercased and
 * www.-stripped; "" for an unparseable href. */
export function hostOf(href: string, base: string): string {
  try {
    return new URL(href, base).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Parses a destination host out of a citation element's display text --
 * either a bare host ("RTINGS.com") or a full breadcrumb-style URL
 * ("https://www.pcmag.com › ... › Headphones"). Never a real URL parse
 * (the text isn't one); just enough structure (strip scheme, stop at the
 * first slash/breadcrumb separator/whitespace) to recover the host. */
export function hostFromCiteText(text: string): string {
  const withoutScheme = text.trim().replace(/^https?:\/\//i, "");
  const host = withoutScheme.split(/[\s/›]/)[0] ?? "";
  return host.toLowerCase().replace(/^www\./, "");
}

export function engineConfigFor(hostname: string): EngineConfig | null {
  return ENGINES[hostname] ?? null;
}

function firstMatchingLink(result: Element, selectors: readonly string[]): HTMLAnchorElement | null {
  for (const selector of selectors) {
    const match = result.querySelector<HTMLAnchorElement>(selector);
    if (match) return match;
  }
  return null;
}

/** The result elements on the page whose link host matches the curated list. */
export function findSpamResults(
  doc: Document,
  base: string,
  config: EngineConfig,
  domains: readonly string[]
): Element[] {
  const engineHost = hostOf(base, base);
  const out: Element[] = [];
  for (const result of doc.querySelectorAll(config.resultSelector)) {
    if (result.hasAttribute(HIDDEN_ATTR)) continue;

    const link = firstMatchingLink(result, config.linkSelectors);
    const href = link?.getAttribute("href");
    let host = href ? hostOf(href, base) : "";

    // A same-origin host here means the anchor was a same-page/internal
    // link (a search-engine redirect, a refinement pill), never the
    // result's real destination -- fall back to the citation text instead
    // of trusting it, on engines where one is configured.
    if ((!host || host === engineHost) && config.citeSelector) {
      const cite = result.querySelector(config.citeSelector);
      if (cite?.textContent) host = hostFromCiteText(cite.textContent);
    }

    if (host && host !== engineHost && matchesDomainOrSubdomain(host, domains)) out.push(result);
  }
  return out;
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `[${HIDDEN_ATTR}]{display:none!important}`;
  (doc.head || doc.documentElement).append(style);
}

function showBanner(doc: Document, config: EngineConfig, count: number, onShow: () => void): void {
  if (doc.getElementById(BANNER_ID)) return;
  const anchor = doc.querySelector(config.bannerAnchorSelector);
  if (!anchor) return;

  const banner = doc.createElement("div");
  banner.id = BANNER_ID;
  banner.style.cssText =
    "margin:8px 0;padding:8px 12px;border:1px solid #ccc;border-radius:6px;" +
    "font:13px system-ui,sans-serif;color:#444;background:#f5f5f5;";

  const label = doc.createElement("span");
  label.textContent = `${count} low-quality result${count === 1 ? "" : "s"} hidden by Moat. `;

  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Show";
  button.style.cssText = "margin-left:6px;cursor:pointer;";
  button.addEventListener("click", () => {
    onShow();
    banner.remove();
  });

  banner.append(label, button);
  anchor.prepend(banner);
}

function hideResults(results: readonly Element[]): void {
  for (const result of results) result.setAttribute(HIDDEN_ATTR, "");
}

function unhideResults(results: readonly Element[]): void {
  for (const result of results) result.removeAttribute(HIDDEN_ATTR);
}

/** One filtering pass. Exported for tests; run() schedules it. */
export function runSearchSlopPass(
  doc: Document,
  base: string,
  config: EngineConfig,
  domains: readonly string[]
): number {
  const targets = findSpamResults(doc, base, config, domains);
  if (targets.length === 0) return 0;
  ensureStyle(doc);
  hideResults(targets);
  showBanner(doc, config, targets.length, () => unhideResults(targets));
  return targets.length;
}

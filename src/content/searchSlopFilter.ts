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
// change their result markup without notice and this hasn't been verified
// against a real search results page. Best-effort, fails closed (no matches
// found just means no filtering), never breaks the page.
import { matchesDomainOrSubdomain } from "../shared/domainChain";

const HIDDEN_ATTR = "data-moat-slop-hidden";
const STYLE_ID = "moat-search-slop-style";
const BANNER_ID = "moat-search-slop-banner";

interface EngineConfig {
  /** Each matched element is one organic result "card" to evaluate. */
  resultSelector: string;
  /** The result's own title/link, whose host is checked against the domain list. */
  linkSelector: string;
  /** Where to insert the "N results hidden" banner. */
  bannerAnchorSelector: string;
}

const ENGINES: Record<string, EngineConfig> = {
  "www.google.com": {
    resultSelector: "#search .g, #rso > div",
    linkSelector: "a[href]",
    bannerAnchorSelector: "#search, #rso",
  },
  "www.bing.com": {
    resultSelector: "li.b_algo",
    linkSelector: "h2 a[href], a[href]",
    bannerAnchorSelector: "#b_content, #b_results",
  },
  "duckduckgo.com": {
    resultSelector: '[data-testid="result"], .result',
    linkSelector: '[data-testid="result-title-a"], .result__a, a[href]',
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

export function engineConfigFor(hostname: string): EngineConfig | null {
  return ENGINES[hostname] ?? null;
}

/** The result elements on the page whose link host matches the curated list. */
export function findSpamResults(
  doc: Document,
  base: string,
  config: EngineConfig,
  domains: readonly string[]
): Element[] {
  const out: Element[] = [];
  for (const result of doc.querySelectorAll(config.resultSelector)) {
    if (result.hasAttribute(HIDDEN_ATTR)) continue;
    const link = result.querySelector<HTMLAnchorElement>(config.linkSelector);
    const href = link?.getAttribute("href");
    if (!href) continue;
    const host = hostOf(href, base);
    if (host && matchesDomainOrSubdomain(host, domains)) out.push(result);
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

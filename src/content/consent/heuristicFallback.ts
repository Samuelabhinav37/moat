// Fallback for cookie banners that Consent-O-Matic's curated CMP list
// (../consent -- rules/consent-rules.json) doesn't recognize. consentRejector.ts
// only calls into this after runConsentRejection (engine.ts) reports no CMP
// matched on the current DOM snapshot -- this never preempts a curated match.
//
// Research (2025-2026) found manipulative visual-dominance patterns --
// oversized "Accept," visually-buried "Reject" -- on 38% of even nominally
// GDPR-compliant banners that aren't in any curated CMP list. This module
// finds a banner-shaped container mentioning cookies/consent, then looks for
// an unambiguous reject-family button inside it by TEXT match only.
//
// Same boundary as the Consent-O-Matic path: selector-discovery-and-click
// only, never injects or evaluates page code. A wrong click here is worse
// than doing nothing (the user's preference gets submitted), so this only
// acts when there is exactly one visible, enabled, clickable candidate
// unambiguously matching a reject phrase -- ambiguity or low confidence
// means "do nothing," not "guess."

const ACCEPT_PATTERNS = [
  /^accept all$/i,
  /^accept cookies$/i,
  /^accept$/i,
  /^agree$/i,
  /^i agree$/i,
  /^allow all$/i,
  /^allow cookies$/i,
  /^got it$/i,
  /^ok(?:ay)?$/i,
];

const REJECT_PATTERNS = [
  /^reject all$/i,
  /^reject cookies$/i,
  /^reject$/i,
  /^decline all$/i,
  /^decline$/i,
  /^disagree$/i,
  /^deny$/i,
  /^necessary only$/i,
  /^only necessary$/i,
  /^essential only$/i,
  /^continue without accepting$/i,
];

const BANNER_TEXT_RE = /\b(cookies?|consent|gdpr|privacy preferences)\b/i;

// A plain object of pure functions rather than a class -- lets tests stub
// geometry without touching jsdom's getBoundingClientRect/getComputedStyle,
// which (per adCollapse.test.ts's own note) aren't representative in jsdom.
export interface GeometryReader {
  rectOf(el: Element): { width: number; height: number };
  isVisible(el: Element): boolean;
}

export const defaultGeometry: GeometryReader = {
  rectOf: (el) => el.getBoundingClientRect(),
  isVisible: (el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  },
};

function textOf(el: Element): string {
  return (el.textContent ?? "").trim().replace(/\s+/g, " ");
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function isClickable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "button") return true;
  if (tag === "a") return el.hasAttribute("href");
  if (tag === "input") return (el as HTMLInputElement).type === "button" || (el as HTMLInputElement).type === "submit";
  return el.getAttribute("role") === "button";
}

const CLICKABLE_SELECTOR = "button, a, [role='button'], input[type='button'], input[type='submit']";

const CONTAINER_SELECTOR = "div, section, aside, dialog, [role='dialog'], [role='alertdialog']";

/** The smallest banner-shaped container (div/section/aside/dialog) whose
 * own text mentions cookies/consent and is short enough to be a banner
 * (1500 chars), holding a clickable reject-pattern button.
 *
 * Works up from the reject-pattern buttons, which are few, instead of
 * reading the text of every div on the page. That scan read each
 * container's whole subtree text, so its cost grew with the square of the
 * page size, and consentRejector.ts runs this repeatedly while a page
 * loads. A button's first qualifying ancestor is its tightest banner;
 * ancestors only get longer, so the climb stops past 1500 chars. */
export function findBannerContainer(root: ParentNode = document): HTMLElement | null {
  const rejectButtons = Array.from(root.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)).filter(
    (b) => isClickable(b) && matchesAny(textOf(b), REJECT_PATTERNS)
  );

  let best: { el: HTMLElement; textLength: number } | null = null;
  for (const button of rejectButtons) {
    for (let el = button.parentElement; el; el = el.parentElement) {
      if (root !== document && !root.contains(el)) break;
      if (!el.matches(CONTAINER_SELECTOR)) continue;
      const text = textOf(el);
      if (text.length > 1500) break;
      if (text.length === 0 || !BANNER_TEXT_RE.test(text)) continue;
      if (best === null || text.length < best.textLength) best = { el, textLength: text.length };
      break;
    }
  }
  return best?.el ?? null;
}

export interface VisualDominance {
  acceptArea: number;
  rejectArea: number;
  /** acceptArea / rejectArea; >1 means accept renders larger. Informational
   * only -- see findConfidentRejectButton's header comment for why this
   * doesn't gate the click decision. */
  ratio: number | null;
}

export interface FallbackResult {
  handled: boolean;
  rejectButton?: HTMLElement;
  reason: string;
  dominance?: VisualDominance;
}

/** Only the reject-side confidence gates whether this clicks anything --
 * exactly one visible, enabled, unambiguous reject-pattern match. An
 * accept-vs-reject size/contrast comparison is computed and returned for
 * observability (this is explicitly what research flagged as the
 * manipulative pattern), but is deliberately NOT a blocking gate: a
 * genuinely-identified reject button that a site rendered small/low-
 * contrast specifically to bury it is exactly the case this exists to see
 * past, not a reason to refuse to click it. Blocking only on genuine
 * ambiguity (no match, multiple conflicting matches, not actually
 * clickable) keeps the false-click risk low without also reintroducing the
 * dark pattern by declining to act on a button the site deliberately made
 * hard to notice. */
export function findConfidentRejectButton(
  container: HTMLElement,
  geometry: GeometryReader = defaultGeometry,
): FallbackResult {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)).filter(isClickable);

  const rejectMatches = candidates.filter((b) => matchesAny(textOf(b), REJECT_PATTERNS));
  const acceptMatches = candidates.filter((b) => matchesAny(textOf(b), ACCEPT_PATTERNS));

  if (rejectMatches.length === 0) return { handled: false, reason: "no reject-pattern button found" };
  if (rejectMatches.length > 1) {
    return { handled: false, reason: "ambiguous: multiple reject-pattern buttons" };
  }

  // Length is confirmed exactly 1 above (not 0, not >1).
  const reject = rejectMatches[0]!;
  if (acceptMatches.length === 1 && acceptMatches[0] === reject) {
    return { handled: false, reason: "accept and reject patterns matched the same element" };
  }
  if (!geometry.isVisible(reject)) return { handled: false, reason: "reject button not visible" };

  const rejectRect = geometry.rectOf(reject);
  if (rejectRect.width <= 0 || rejectRect.height <= 0) {
    return { handled: false, reason: "reject button has zero rendered size" };
  }

  let dominance: VisualDominance | undefined;
  if (acceptMatches.length === 1) {
    const acceptRect = geometry.rectOf(acceptMatches[0]!);
    const acceptArea = acceptRect.width * acceptRect.height;
    const rejectArea = rejectRect.width * rejectRect.height;
    dominance = { acceptArea, rejectArea, ratio: rejectArea > 0 ? acceptArea / rejectArea : null };
  }

  return { handled: true, reason: "confident single reject match", rejectButton: reject, dominance };
}

/** Entry point consentRejector.ts calls after a curated-CMP attempt reports
 * not handled. Finds a banner, looks for a confident reject match, and
 * clicks it if found. Safe to call repeatedly (no curated banner mounted
 * yet just means findBannerContainer returns null). */
export function runHeuristicFallback(root: ParentNode = document, geometry?: GeometryReader): FallbackResult {
  const container = findBannerContainer(root);
  if (!container) return { handled: false, reason: "no banner container found" };

  const result = findConfidentRejectButton(container, geometry);
  if (result.handled && result.rejectButton) result.rejectButton.click();
  return result;
}

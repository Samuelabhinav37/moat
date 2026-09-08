// Collapses the empty rectangle a network-blocked ad leaves behind. The DNR
// rules already stopped the request, so the <iframe>/<img> is in the DOM but
// never painted content; the page often still reserves its slot height,
// leaving a visible gap the cosmetic selectors didn't catch. This does one
// pass (plus a delayed second for lazy slots) over the handful of elements
// that could be a blocked ad -- iframe[src] / img[src] whose host is a known
// ad network (rules/ad-networks.json), and empty <ins class="adsbygoogle">
// -- hides them, and collapses an ancestor that was only holding the ad.
//
// Not a MutationObserver -- two timed passes, same "no persistent DOM
// watcher for cosmetic filtering" design as the rest of the feature.
import { domainChain } from "../shared/domainChain";

// Common IAB / display-ad slot dimensions (WxH). An ancestor whose own box
// matches one of these, or is at least MIN_RESERVED_PX tall with nothing in
// it but the blocked ad, is treated as reserved ad space and collapsed.
const AD_SLOT_SIZES = new Set([
  "300x250", "336x280", "728x90", "970x250", "970x90", "320x50", "320x100",
  "300x600", "160x600", "300x1050", "468x60", "234x60", "120x600", "250x250",
  "200x200", "180x150", "300x50", "320x480", "250x360", "580x400", "888x244",
]);
const MIN_RESERVED_PX = 20;
const MAX_ANCESTOR_WALK = 3;
const SECOND_PASS_DELAY_MS = 2500;
const HANDLED_ATTR = "data-moat-ad-collapsed";
const STYLE_ID = "moat-ad-collapse";

/** hostname of an absolute URL string, lowercased; "" for a relative or
 * unparseable src (a blocked ad is essentially always absolute cross-origin). */
export function hostOf(src: string): string {
  try {
    return new URL(src).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True if `host` is one of `adNetworks`, or a subdomain of one. */
export function isAdNetworkHost(host: string, adNetworks: ReadonlySet<string>): boolean {
  if (!host) return false;
  return domainChain(host).some((domain) => adNetworks.has(domain));
}

/** An <ins class="adsbygoogle"> that never got filled (AdSense writes an
 * <iframe> child and sets data-ad-status="filled" when a creative loads). */
function isUnfilledAdsbygoogle(el: Element): boolean {
  return (
    el.tagName === "INS" &&
    el.classList.contains("adsbygoogle") &&
    el.getAttribute("data-ad-status") !== "filled" &&
    el.querySelector("iframe") === null
  );
}

/** The elements on the page that are a blocked/empty ad slot. */
export function findAdElements(doc: Document, adNetworks: ReadonlySet<string>): Element[] {
  const out: Element[] = [];
  for (const el of doc.querySelectorAll<HTMLElement>(
    "iframe[src], img[src], ins.adsbygoogle"
  )) {
    if (el.hasAttribute(HANDLED_ATTR)) continue;
    if (isUnfilledAdsbygoogle(el)) {
      out.push(el);
      continue;
    }
    const src = el.getAttribute("src");
    if (src && isAdNetworkHost(hostOf(src), adNetworks)) out.push(el);
  }
  return out;
}

interface Geometry {
  /** Rendered height of an element, in CSS px. */
  heightOf(el: Element): number;
  /** Whether an element takes up space / isn't hidden. */
  isRendered(el: Element): boolean;
}

function domGeometry(win: Window): Geometry {
  return {
    heightOf: (el) => el.getBoundingClientRect().height,
    isRendered: (el) => {
      const style = win.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    },
  };
}

/** Whether `ancestor` is holding nothing but the (about-to-be-hidden) ad
 * chain and was reserving space for it -- so collapsing it removes a gap
 * rather than real content. */
export function shouldCollapseAncestor(ancestor: Element, adChain: Set<Element>, geom: Geometry): boolean {
  const tag = ancestor.tagName;
  if (tag === "BODY" || tag === "HTML" || tag === "MAIN" || tag === "ARTICLE" || tag === "SECTION") return false;
  const role = ancestor.getAttribute("role");
  if (role === "main" || role === "navigation" || role === "banner" || role === "contentinfo") return false;

  for (const child of ancestor.children) {
    if (adChain.has(child)) continue;
    const t = child.tagName;
    if (t === "SCRIPT" || t === "STYLE" || t === "LINK" || t === "TEMPLATE" || t === "NOSCRIPT") continue;
    if ((child as HTMLElement).hidden) continue;
    if (geom.isRendered(child)) return false; // real sibling content -- leave the ancestor alone
  }

  const height = geom.heightOf(ancestor);
  if (height >= MIN_RESERVED_PX) return true;
  const rect = ancestor.getBoundingClientRect();
  return AD_SLOT_SIZES.has(`${Math.round(rect.width)}x${Math.round(rect.height)}`);
}

function collapse(el: Element): void {
  el.setAttribute(HANDLED_ATTR, "");
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `[${HANDLED_ATTR}]{display:none!important}`;
  (doc.head || doc.documentElement).append(style);
}

/** One collapse pass. Exported for tests; startAdCollapse schedules it. */
export function runAdCollapsePass(doc: Document, adNetworks: ReadonlySet<string>, geom: Geometry): number {
  const targets = findAdElements(doc, adNetworks);
  if (targets.length === 0) return 0;
  ensureStyle(doc);

  for (const ad of targets) {
    collapse(ad);
    const chain = new Set<Element>([ad]);
    let node: Element | null = ad.parentElement;
    for (let i = 0; i < MAX_ANCESTOR_WALK && node; i += 1) {
      if (!shouldCollapseAncestor(node, chain, geom)) break;
      collapse(node);
      chain.add(node);
      node = node.parentElement;
    }
  }
  return targets.length;
}

/** Wire the two passes. No-op cleanup handle for symmetry with the surveyor. */
export function startAdCollapse(win: Window, adNetworks: ReadonlySet<string>): void {
  if (adNetworks.size === 0) return;
  const doc = win.document;
  const geom = domGeometry(win);
  const pass = (): void => {
    try {
      runAdCollapsePass(doc, adNetworks, geom);
    } catch {
      // A collapse pass is best-effort; never let it break the page.
    }
  };
  if (doc.readyState === "complete") pass();
  else win.addEventListener("load", pass, { once: true });
  win.setTimeout(pass, SECOND_PASS_DELAY_MS);
}

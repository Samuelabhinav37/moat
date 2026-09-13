// DOM-walking half of the invisible-text check (colorContrast.ts has the
// pure math). Exists to catch, automatically, the exact class of bug found
// in v0.11.89: a page-level text color used inside a component with a
// different explicit background, resolving to near-invisible text. See
// options.render.test.ts / popup.render.test.ts for where this actually runs.
import { contrastRatio, INVISIBLE_TEXT_CONTRAST_FLOOR, isTransparent, parseColor } from "./colorContrast";

export interface InvisibleTextFinding {
  selector: string;
  text: string;
  color: string;
  background: string;
  ratio: number;
}

// getComputedStyle() in jsdom doesn't substitute var(--x) into another
// property's own computed value -- confirmed directly: `color: var(--t2)`
// comes back as the literal string "var(--t2)", not the resolved color. It
// DOES resolve a custom property's own value correctly via
// getPropertyValue(), including through inheritance, so a single
// regex-and-lookup round trip resolves it for real. This repo's CSS only
// ever uses the plain single-argument var(--name) form (no fallback
// argument, no nesting -- confirmed by grepping every var() usage in
// options.html/popup.html/theme.css), so that's the only case handled.
function resolveComputedColor(value: string, element: Element): string {
  const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
  const propertyName = match?.[1];
  if (!propertyName) return value;
  const resolved = getComputedStyle(element).getPropertyValue(propertyName).trim();
  return resolved || value;
}

function nearestExplicitBackground(start: Element): string | null {
  for (let el: Element | null = start; el; el = el.parentElement) {
    const bg = resolveComputedColor(getComputedStyle(el).backgroundColor, el);
    if (!isTransparent(bg)) return bg;
  }
  return null;
}

function hasOwnNonWhitespaceText(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0) return true;
  }
  return false;
}

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList.length > 0 ? `.${[...el.classList].join(".")}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

/** Every element under `root` whose own direct text renders in a color
 * that's practically indistinguishable from its nearest explicit ancestor
 * background. Only elements with real text of their own are checked -- a
 * container whose content is entirely child elements is skipped; those
 * children get checked on their own. */
export function findInvisibleText(root: Element): InvisibleTextFinding[] {
  const findings: InvisibleTextFinding[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode as Element | null;
  // TreeWalker starts ON root itself; visit it too (root can carry direct text).
  while (node) {
    if (hasOwnNonWhitespaceText(node)) {
      const colorValue = resolveComputedColor(getComputedStyle(node).color, node);
      const color = parseColor(colorValue);
      const backgroundValue = color ? nearestExplicitBackground(node) : null;
      const background = backgroundValue ? parseColor(backgroundValue) : null;
      if (color && background) {
        const ratio = contrastRatio(color, background);
        if (ratio < INVISIBLE_TEXT_CONTRAST_FLOOR) {
          findings.push({
            selector: describe(node),
            text: (node.textContent ?? "").trim().slice(0, 60),
            color: colorValue,
            background: backgroundValue!,
            ratio,
          });
        }
      }
    }
    node = walker.nextNode() as Element | null;
  }
  return findings;
}

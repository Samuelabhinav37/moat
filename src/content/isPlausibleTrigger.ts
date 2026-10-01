// Pulled out of mainWorldGuard.ts, which mutates window.open and navigator
// as soon as it's imported -- this pure heuristic is importable in tests
// (jsdom) without any of that firing.

// Real sites build buttons out of plain elements too: Microsoft's account
// picker tiles are divs with a role and tabindex, and many "Sign in" and
// "Pay" buttons are divs with a click handler and a pointer cursor.
// Requiring a native <a>/<button> blocked those popups.
const INTERACTIVE_SELECTOR =
  'a,button,input[type="submit"],input[type="button"],input[type="image"],label,summary,' +
  '[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="listitem"],' +
  '[role="gridcell"],[tabindex]:not([tabindex="-1"])';

// How far up a click target to look for a pointer cursor. A popunder
// script's handler on document or body sees clicks on plain text, where
// the cursor is "auto" or "text", so those still don't count.
const MAX_POINTER_ANCESTORS = 6;

function closestInteractive(target: Element): Element | null {
  const byMarkup = target.closest(INTERACTIVE_SELECTOR);
  if (byMarkup) return byMarkup;
  // cursor is inherited, so climb to where the pointer cursor starts: if
  // that's body or html, the whole page is "clickable" and it says nothing.
  let el: Element | null = target;
  for (let depth = 0; el && depth < MAX_POINTER_ANCESTORS; depth++, el = el.parentElement) {
    if (el === document.body || el === document.documentElement) return null;
    if (getComputedStyle(el).cursor !== "pointer") continue;
    let origin: Element = el;
    while (origin.parentElement && getComputedStyle(origin.parentElement).cursor === "pointer") {
      origin = origin.parentElement;
    }
    return origin === document.body || origin === document.documentElement ? null : el;
  }
  return null;
}

/**
 * True if `target` looks like a real, visible, interactive element a user
 * could plausibly have clicked -- as opposed to the classic popunder hijack
 * pattern of an invisible, full-viewport element catching every click on
 * the page and treating it as "the" trigger for a window.open().
 */
export function isPlausibleTrigger(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = closestInteractive(target);
  if (!interactive) return false;

  const rect = interactive.getBoundingClientRect();
  const style = getComputedStyle(interactive);
  const coversViewport = rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
  // Opacity is the most common invisible-click-catcher trick, but not the
  // only one -- visibility:hidden and a fully-collapsed clip region produce
  // the same "invisible but still catching clicks" effect. This is a
  // best-effort heuristic either way (see the file header) and can't cover
  // every possible hiding technique.
  const nearInvisible =
    parseFloat(style.opacity) < 0.05 ||
    style.visibility === "hidden" ||
    style.clipPath === "inset(100%)" ||
    style.clip === "rect(0px, 0px, 0px, 0px)";
  if (coversViewport && nearInvisible) return false;

  return true;
}

// Pulled out of mainWorldGuard.ts, which mutates window.open and navigator
// as soon as it's imported -- this pure heuristic is importable in tests
// (jsdom) without any of that firing.

/**
 * True if `target` looks like a real, visible, interactive element a user
 * could plausibly have clicked -- as opposed to the classic popunder hijack
 * pattern of an invisible, full-viewport element catching every click on
 * the page and treating it as "the" trigger for a window.open().
 */
export function isPlausibleTrigger(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'a,button,[role="button"],input[type="submit"],input[type="button"],label,summary'
  );
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

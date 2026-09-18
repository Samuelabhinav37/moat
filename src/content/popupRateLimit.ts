// Pulled out of mainWorldGuard.ts for the same reason isPlausibleTrigger.ts
// was: pure logic, testable without triggering that file's import-time
// window.open/navigator mutation, and -- specific to this one -- without
// needing a *trusted* click event, which no test environment (jsdom or a
// real browser) can ever fake: isTrusted is a browser-computed read-only
// property on script-dispatched events, by design, not a gap in test
// tooling. A rate limiter needs no trusted click at all to test.
//
// Why this exists: isPlausibleTrigger.ts deliberately allows a large,
// genuinely visible element to trigger a popup (a real full-screen modal's
// close button is exactly that shape, and its own tests encode that on
// purpose) -- so a site that wires its actual, visible video-player area
// (not full-viewport, not invisible -- neither red flag isPlausibleTrigger
// checks for) to open a new popup on every click passes that check every
// single time, individually. No single click-plausibility heuristic can
// tell "a real large button" from "a disguised large button" apart by shape
// alone. What's different is *frequency*: no legitimate page needs more
// than a couple of genuinely-intentional new-tab opens in quick succession;
// a page that does is exactly the pattern this exists to catch, regardless
// of whether any individual click looks plausible on its own.
const MAX_APPROVED_POPUPS_PER_WINDOW = 2;
const RATE_WINDOW_MS = 20_000;

export interface PopupRateLimiter {
  /** Records and allows one more approved popup, or returns false without
   * recording one if the page has already used up its allowance within the
   * trailing window. `now` is injected (not read internally) so this stays
   * a pure function of its inputs for tests -- mainWorldGuard.ts always
   * passes performance.now(). */
  tryApprove(now: number): boolean;
}

export function createPopupRateLimiter(
  maxPerWindow: number = MAX_APPROVED_POPUPS_PER_WINDOW,
  windowMs: number = RATE_WINDOW_MS
): PopupRateLimiter {
  let approvedTimestamps: number[] = [];
  return {
    tryApprove(now: number): boolean {
      approvedTimestamps = approvedTimestamps.filter((t) => now - t < windowMs);
      if (approvedTimestamps.length >= maxPerWindow) return false;
      approvedTimestamps.push(now);
      return true;
    },
  };
}

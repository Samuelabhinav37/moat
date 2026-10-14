// Registered (MAIN world, document_start, every frame) for the trackers whose
// cookies Moat strips (background/optionalContentScripts.ts builds the match
// list from rules/tracker-cookie-hosts.json). The header rules
// (ruleset_tracker-cookies) stop cookies sent and set over the network; this
// stops the tracker's own script setting them with document.cookie, and trims
// the referrer it can read to the page's origin. Privacy Badger's
// clobbercookie.js does the same for its cookie-blocked frames, with a no-op.
// Here the frame's own writes stay readable in memory for the document's
// life (so "are cookies on?" checks still pass) and are saved for real only
// if the guard is lifted.
//
// Registered rather than injected when the frame commits: injected that late,
// the frame's inline script had already set its cookie (e2e, 2026-10-14).
// So the checks the worker can't make in time happen here: only inside a
// frame, and not when the page is the tracker's own site or another site of
// the same company. A paused page lifts the guard from the worker
// (background/cookieClobber.ts).
//
// An own property on this one document, not Document.prototype: other
// frames, and the page itself, are untouched.
import { COOKIE_GUARD_RELEASED, COOKIE_GUARD_WRITES, isSameCompany, shadowCookieString } from "../shared/trackerCookieGuard";

/** Company site groups that include a stripped tracker, inlined at build
 * time (scripts/build.mjs). */
declare const __MOAT_TRACKER_OWNERS__: string[][];

function topHost(): string | null {
  // Chrome lists the frame's ancestors; Firefox has only the referrer.
  const ancestors = location.ancestorOrigins;
  const top = ancestors && ancestors.length > 0 ? ancestors[ancestors.length - 1] : document.referrer;
  try {
    return top ? new URL(top).hostname : null;
  } catch {
    return null;
  }
}

(() => {
  try {
    if (window === window.top) return;
    if ((document as unknown as Record<symbol, unknown>)[Symbol.for(COOKIE_GUARD_RELEASED)]) return;
    const page = topHost();
    // Unknown page: guard anyway, the frame is a cookie-blocked tracker.
    if (page && isSameCompany(location.hostname, page, __MOAT_TRACKER_OWNERS__)) return;
    const writes: string[] = [];
    (document as unknown as Record<symbol, unknown>)[Symbol.for(COOKIE_GUARD_WRITES)] = writes;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => shadowCookieString(writes),
      set: (value: unknown) => {
        writes.push(String(value));
      },
    });
    const referrer = document.referrer;
    if (referrer) {
      let origin = "";
      try {
        origin = `${new URL(referrer).origin}/`;
      } catch {
        // Unparseable: hide it entirely.
      }
      Object.defineProperty(document, "referrer", { configurable: true, get: () => origin });
    }
  } catch {
    // A document that won't take the property: leave it.
  }
})();

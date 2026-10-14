// Shared by the cookie guard's two halves (background/cookieClobber.ts and
// content/cookieClobber.ts): whether a tracker frame belongs to the page's
// own company, in which case its cookies are first-party and left alone.
import { siteOf } from "./siteOf";

/** Marks a document whose cookie guard was lifted (its page is paused), so
 * the guard skips it whichever of the two scripts runs first. */
export const COOKIE_GUARD_RELEASED = "moat.cookieGuard.released";

/** Where the guard keeps a frame's own cookie writes (raw strings, in
 * order), so a release can save them for real. */
export const COOKIE_GUARD_WRITES = "moat.cookieGuard.writes";

/** A frame's cookies as its guard shows them: only what the frame itself
 * wrote while guarded, never the browser's stored ones. Pure, for tests.
 * An expired or zero max-age write removes the name, as the browser would. */
export function shadowCookieString(writes: readonly string[]): string {
  const jar = new Map<string, string>();
  for (const raw of writes) {
    const [pair = "", ...attrs] = raw.split(";");
    const eq = pair.indexOf("=");
    const name = (eq < 0 ? "" : pair.slice(0, eq)).trim();
    const value = (eq < 0 ? pair : pair.slice(eq + 1)).trim();
    const removed = attrs.some((attr) => {
      const [key = "", val = ""] = attr.split("=").map((part) => part.trim());
      if (key.toLowerCase() === "max-age") return Number(val) <= 0;
      if (key.toLowerCase() === "expires") return Date.parse(val) <= Date.now();
      return false;
    });
    jar.delete(name);
    if (!removed) jar.set(name, value);
  }
  return [...jar].map(([name, value]) => (name ? `${name}=${value}` : value)).join("; ");
}

/** True when `frameHost` and `pageHost` are the same site, or two sites of
 * one company (Privacy Badger's multiDomainFirstParties groups). */
export function isSameCompany(frameHost: string, pageHost: string, groups: readonly (readonly string[])[]): boolean {
  const frameSite = siteOf(frameHost);
  const pageSite = siteOf(pageHost);
  if (frameSite === pageSite) return true;
  return groups.some((group) => group.includes(frameSite) && group.includes(pageSite));
}

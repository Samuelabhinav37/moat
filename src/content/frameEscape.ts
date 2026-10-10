// Pure check behind one pop-up firewall rule (mainWorldGuard.ts imports it;
// kept apart so tests can load it without the guard's side effects).
//
// A frame embedded from another site may open new windows to its own site
// or to the page's site, and nowhere else, even after a real click on a real
// button. Measured on streamsgate.co, 10 Oct 2026: Adcash ran inside an
// xstream.st player frame and opened adblockerpremium.online when the user
// pressed the player's play button. The click was genuine, so the
// click-shape checks let it through. A YouTube embed opening youtube.com, a
// PayPal button opening paypal.com, or a sign-in frame opening its own
// provider all stay allowed: they open their own site.
import { siteOf } from "../shared/siteOf";

export interface FrameContext {
  /** This frame's address. */
  href: string;
  /** Whether this is the tab's top page. */
  isTop: boolean;
  /** location.ancestorOrigins, nearest first (Chrome); empty where missing. */
  ancestorOrigins: readonly string[];
  /** document.referrer: the embedding page, where ancestorOrigins is missing (Firefox). */
  referrer: string;
}

function hostOf(url: string, base?: string): string | null {
  try {
    const u = new URL(url, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

/** The tab's top site as this frame can see it, or null when it can't. */
export function topSiteOf(ctx: FrameContext): string | null {
  const top = ctx.ancestorOrigins.length ? ctx.ancestorOrigins[ctx.ancestorOrigins.length - 1]! : ctx.referrer;
  const host = top ? hostOf(top) : null;
  return host ? siteOf(host) : null;
}

/** True when a cross-site frame tries to open a window on a third site
 * (or a blank one it could send anywhere afterwards). */
export function isFrameEscape(target: string | URL | undefined | null, ctx: FrameContext): boolean {
  if (ctx.isTop) return false;
  const frameHost = hostOf(ctx.href);
  const topSite = topSiteOf(ctx);
  // A frame Moat can't place (about:blank, a page with no referrer) is left
  // to the other checks rather than guessed at.
  if (!frameHost || !topSite) return false;
  const frameSite = siteOf(frameHost);
  if (frameSite === topSite) return false;
  const raw = target === undefined || target === null ? "" : String(target).trim();
  if (raw === "" || raw === "about:blank") return true;
  const targetHost = hostOf(raw, ctx.href);
  if (!targetHost) return true;
  const targetSite = siteOf(targetHost);
  return targetSite !== frameSite && targetSite !== topSite;
}

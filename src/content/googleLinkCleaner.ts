// Gmail and Google Docs wrap the links in a message or document in Google's
// redirect (www.google.com/url?q=<destination>), so Google learns of every
// click. ruleset_link-skip (scripts/lib/linkRules.mjs) skips the wrapper when
// the destination is written plainly; this rewrites the link itself, so an
// encoded destination goes straight there too. Privacy Badger does the same
// (its js/firstparties/google.js).
//
// Follows the "Tracking in links" list, Moat's switch and a paused site.
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";

const WRAPPER = /^https:\/\/www\.google\.[a-z.]{2,7}\/url\?/;
const SELECTOR = 'a[href^="https://www.google."]';

/** The destination of a Google-wrapped link, or null when `href` isn't one
 * or doesn't lead to a web address. Unwraps twice: Docs can wrap a link
 * that's already wrapped. Pure, for tests. */
export function unwrapGoogleLink(href: string, depth = 0): string | null {
  if (!WRAPPER.test(href)) return null;
  let target: string | null;
  try {
    const params = new URL(href).searchParams;
    target = params.get("url") ?? params.get("q");
  } catch {
    return null;
  }
  if (!target || !/^https?:\/\//i.test(target)) return null;
  try {
    const url = new URL(target);
    // "https://bank.com@evil.example" reads as bank.com but goes to evil.example.
    if (url.username || url.password) return null;
  } catch {
    return null;
  }
  return (depth === 0 && unwrapGoogleLink(target, 1)) || target;
}

function clean(anchor: HTMLAnchorElement): void {
  const destination = unwrapGoogleLink(anchor.href);
  if (!destination) return;
  anchor.href = destination;
  anchor.rel = "noreferrer noopener";
}

function cleanWithin(root: ParentNode): void {
  root.querySelectorAll<HTMLAnchorElement>(SELECTOR).forEach(clean);
}

async function start(): Promise<void> {
  const settings = await getEffectiveSettingsHere();
  if (isDisabled(settings) || settings.filterGroups["url-tracking"] === false) return;
  cleanWithin(document);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLAnchorElement) clean(record.target);
      for (const node of record.addedNodes) {
        if (node instanceof HTMLAnchorElement) clean(node);
        else if (node instanceof Element) cleanWithin(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
}

void start().catch(() => {
  // Settings unreadable: leave the links as they are.
});

// Pure logic behind the popup's manual "Clear site data" action -- kept
// separate from the actual browser.browsingData.remove() call (wired up in
// popup.ts) so the cross-browser branching below is testable without a real
// browsingData implementation.
//
// Chrome and Firefox scope browsingData.remove() to a site in genuinely
// different, non-interchangeable shapes -- this isn't something
// webextension-polyfill smooths over, unlike most of the rest of this
// codebase's browser.* calls:
//   - Firefox: RemovalOptions.hostnames, an array of bare hostnames
//     ("example.com"), supported only for cookies/indexedDB/localStorage/
//     serviceWorkers.
//     https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browsingData/RemovalOptions
//   - Chrome (MV3): RemovalOptions.origins, an array of full origin URLs
//     ("https://example.com"), supported for cookies/storage/cache.
//     https://developer.chrome.com/docs/extensions/reference/api/browsingData
// Passing the wrong key is not a thrown error on either browser -- the
// unrecognized key is just ignored, which would silently turn a
// "this site only" removal into an unscoped one. Getting this branch wrong
// is a correctness bug, not a style choice.
//
// Only the four data types both shapes agree on are removed. `cache` is
// deliberately left out even though Chrome's `origins` filter does cover it
// -- keeping the same data-type set on both browsers means this action
// behaves identically everywhere, rather than Chrome quietly doing more.
export const FRESH_START_DATA_TYPES = {
  cookies: true,
  indexedDB: true,
  localStorage: true,
  serviceWorkers: true,
} as const;

export type FreshStartFilter = { hostnames: string[] } | { origins: string[] };

export interface FreshStartRemoval {
  filter: FreshStartFilter;
  dataToRemove: typeof FRESH_START_DATA_TYPES;
  hostname: string;
}

/**
 * Builds the removal request for the given tab URL, or null if this tab
 * isn't a real web page to begin with (a new-tab page, a `chrome://`/
 * `about:` page, an extension page, a `file://` URL). Deliberately doesn't
 * reuse background/index.ts's looser `hostnameOf` -- that one accepts
 * whatever `new URL().hostname` returns for display purposes, but a
 * data-deleting action needs its own explicit http(s)-only check rather
 * than inheriting a helper written for a lower-stakes use.
 */
export function buildFreshStartRemoval(tabUrl: string | undefined, isFirefox: boolean): FreshStartRemoval | null {
  if (!tabUrl) return null;
  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  return {
    filter: isFirefox ? { hostnames: [url.hostname] } : { origins: [url.origin] },
    dataToRemove: FRESH_START_DATA_TYPES,
    hostname: url.hostname,
  };
}

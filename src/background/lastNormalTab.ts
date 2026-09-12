// Remembers the last tab that showed a normal web page (http/https). The
// Settings page opens in its own tab and has no "current page" of its own,
// so its "Trackers" tab (see src/options/) asks the background which tab the
// user was actually looking at. Deliberately tiny and in-memory: this is a
// convenience pointer for one settings view, not tracked history -- it holds
// a single tab id and nothing about what was on it.

let lastNormalTabId: number | null = null;

/** True for a real, normal web page -- not chrome://, about:, or an
 * extension page. Exported so index.ts's live-tab-query fallback (see
 * pickBestNormalTab below) filters candidates the same way this file does. */
export function isNormalPageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Call on tab activation / navigation completion with that tab's URL.
 * A chrome://, about:, or extension page never becomes the remembered tab. */
export function noteTabUrl(tabId: number, url: string | undefined): void {
  if (isNormalPageUrl(url)) lastNormalTabId = tabId;
}

export function getLastNormalTabId(): number | null {
  return lastNormalTabId;
}

export function forgetTab(tabId: number): void {
  if (lastNormalTabId === tabId) lastNormalTabId = null;
}

/**
 * Picks the best fallback candidate from a live `browser.tabs.query({active:
 * true})` result (one tab per open window) when the cached pointer above is
 * stale or was never set -- see index.ts's resolveNormalTabId for exactly
 * when that happens (in short: the service worker restarted while the
 * Settings page itself was the focused tab, and extension pages never seed
 * this pointer). Prefers whichever tab was most recently accessed (Chrome
 * 121+; on older Chrome `lastAccessed` is undefined for everything, so this
 * just keeps `tabs.query`'s own order -- still a normal page, just not
 * necessarily the most recently used one). Pure so the selection logic
 * itself is unit-testable without a browser.tabs mock.
 */
export function pickBestNormalTab(tabs: readonly { id?: number; url?: string; lastAccessed?: number }[]): number | null {
  const normal = tabs.filter(
    (tab): tab is { id: number; url: string; lastAccessed?: number } => tab.id !== undefined && isNormalPageUrl(tab.url)
  );
  normal.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return normal[0]?.id ?? null;
}

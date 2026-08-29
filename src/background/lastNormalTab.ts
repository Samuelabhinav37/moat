// Remembers the last tab that showed a normal web page (http/https). The
// Settings page opens in its own tab and has no "current page" of its own,
// so its "Trackers" tab (see src/options/) asks the background which tab the
// user was actually looking at. Deliberately tiny and in-memory: this is a
// convenience pointer for one settings view, not tracked history -- it holds
// a single tab id and nothing about what was on it.

let lastNormalTabId: number | null = null;

/** Call on tab activation / navigation completion with that tab's URL.
 * A chrome://, about:, or extension page never becomes the remembered tab. */
export function noteTabUrl(tabId: number, url: string | undefined): void {
  if (!url) return;
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return;
  }
  if (protocol === "http:" || protocol === "https:") lastNormalTabId = tabId;
}

export function getLastNormalTabId(): number | null {
  return lastNormalTabId;
}

export function forgetTab(tabId: number): void {
  if (lastNormalTabId === tabId) lastNormalTabId = null;
}

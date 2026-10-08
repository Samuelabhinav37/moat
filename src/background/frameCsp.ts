// Remembers, per tab and frame, whether the document's CSP headers allow
// blob: workers (see shared/cspBlobWorkers.ts). The fingerprint guard needs
// to know before it swaps a page's worker for a blob: bootstrap, and a page
// can't read its own CSP headers. Answered through get-fingerprint-seed.
//
// The answer is tied to the document's URL: the header event reaches this
// worker asynchronously, and in Firefox often after the page's content script
// has already asked. Without the URL, that question would get the previous
// page's answer. So a question for a URL not seen yet waits briefly for its
// headers.
//
// In memory only. Anything unknown (worker restarted, headers never seen,
// about:blank) answers "no", the safe answer: the page's workers then run
// untouched, as before.
import browser, { type WebRequest } from "webextension-polyfill";
import { cspAllowsBlobWorkers } from "../shared/cspBlobWorkers";

interface FrameCsp {
  url: string;
  allowed: boolean;
}

const byTab = new Map<number, Map<number, FrameCsp>>();
const waiting = new Map<string, Array<() => void>>();
/** How long a question waits for its page's headers. */
export const HEADERS_WAIT_MS = 1000;

const withoutHash = (url: string): string => url.split("#", 1)[0]!;
const waitKey = (tabId: number, frameId: number): string => `${tabId}:${frameId}`;

function onHeadersReceived(details: WebRequest.OnHeadersReceivedDetailsType): void {
  if (details.tabId < 0) return;
  const policies: string[] = [];
  for (const header of details.responseHeaders ?? []) {
    const name = header.name.toLowerCase();
    if ((name === "content-security-policy" || name === "content-security-policy-report-only") && header.value) {
      policies.push(header.value);
    }
  }
  let frames = byTab.get(details.tabId);
  // A new top-level document: the old one's frames are gone.
  if (details.type === "main_frame" && details.frameId === 0) frames = undefined;
  if (!frames) byTab.set(details.tabId, (frames = new Map()));
  frames.set(details.frameId, { url: withoutHash(details.url), allowed: cspAllowsBlobWorkers(policies) });
  const key = waitKey(details.tabId, details.frameId);
  for (const wake of waiting.get(key) ?? []) wake();
  waiting.delete(key);
}

export function startFrameCspTracking(): void {
  browser.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame"] },
    ["responseHeaders"]
  );
}

function lookup(tabId: number, frameId: number, url: string): boolean | undefined {
  const entry = byTab.get(tabId)?.get(frameId);
  return entry?.url === url ? entry.allowed : undefined;
}

/** `url`: the asking document's own address (its content script's
 * location.href). */
export async function blobWorkersAllowed(
  tabId: number | undefined,
  frameId: number | undefined,
  url: string | undefined
): Promise<boolean> {
  if (tabId === undefined || frameId === undefined || !url || !/^https?:/.test(url)) return false;
  const address = withoutHash(url);
  const known = lookup(tabId, frameId, address);
  if (known !== undefined) return known;
  const key = waitKey(tabId, frameId);
  const deadline = Date.now() + HEADERS_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, deadline - Date.now());
      const wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
      waiting.set(key, [...(waiting.get(key) ?? []), wake]);
    });
    const answer = lookup(tabId, frameId, address);
    if (answer !== undefined) return answer;
  }
  waiting.delete(key);
  return false;
}

export function forgetTab(tabId: number): void {
  byTab.delete(tabId);
}

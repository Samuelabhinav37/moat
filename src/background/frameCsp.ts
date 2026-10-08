// Remembers, per tab and frame, whether the document's CSP headers allow
// blob: workers (see shared/cspBlobWorkers.ts). The fingerprint guard needs
// to know before it swaps a page's worker for a blob: bootstrap, and a page
// can't read its own CSP headers. Answered through get-fingerprint-seed.
//
// In memory only. If the worker restarted between the response and the
// question there's no entry, and "no" is the safe answer: the page's workers
// then run untouched, as before.
import browser, { type WebRequest } from "webextension-polyfill";
import { cspAllowsBlobWorkers } from "../shared/cspBlobWorkers";

const byTab = new Map<number, Map<number, boolean>>();

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
  frames.set(details.frameId, cspAllowsBlobWorkers(policies));
}

export function startFrameCspTracking(): void {
  browser.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame"] },
    ["responseHeaders"]
  );
}

export function blobWorkersAllowed(tabId: number | undefined, frameId: number | undefined): boolean {
  if (tabId === undefined || frameId === undefined) return false;
  return byTab.get(tabId)?.get(frameId) ?? false;
}

export function forgetTab(tabId: number): void {
  byTab.delete(tabId);
}

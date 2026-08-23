// Safety net behind mainWorldGuard.ts: closes any newly-created tab that
// lands on a domain from the AdGuard Popups / URL Tracking filters, in case
// the popup was opened somewhere our content script never ran (e.g. a PDF
// viewer, or a race on a very slow frame).
import browser from "webextension-polyfill";
import { recordBlock } from "./badge";
import { matchesKnownRedirectDomain, safeHostname } from "./redirectDomainMatch";

let redirectDomains: Set<string> | null = null;

async function loadRedirectDomains(): Promise<Set<string>> {
  if (redirectDomains) return redirectDomains;
  const url = browser.runtime.getURL("rules/redirect-domains.json");
  const list = (await (await fetch(url)).json()) as string[];
  redirectDomains = new Set(list);
  return redirectDomains;
}

/** Merges freshly-fetched domains (see liveUpdates.ts) into the set the tab safety net checks against. */
export async function addLiveRedirectDomains(domains: string[]): Promise<void> {
  const current = await loadRedirectDomains();
  for (const domain of domains) current.add(domain);
}

async function closeSilently(tabId: number, openerTabId: number | undefined): Promise<void> {
  try {
    await browser.tabs.remove(tabId);
  } catch {
    // Already closed by the time we got here -- nothing to do.
  }
  if (openerTabId !== undefined) await recordBlock(openerTabId);
}

interface PendingWatch {
  openerTabId: number | undefined;
  expires: number;
}

const pendingWatch = new Map<number, PendingWatch>();
const WATCH_WINDOW_MS = 4000;

export function initPopupGuard(): void {
  void loadRedirectDomains();

  browser.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
    const domains = await loadRedirectDomains();
    const hostname = safeHostname(details.url);
    if (hostname && matchesKnownRedirectDomain(hostname, domains)) {
      await closeSilently(details.tabId, details.sourceTabId);
      return;
    }
    // Initial URL may just be about:blank (window.open("") then a later
    // script-driven navigation); keep watching this tab briefly.
    pendingWatch.set(details.tabId, {
      openerTabId: details.sourceTabId,
      expires: Date.now() + WATCH_WINDOW_MS,
    });
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    const watch = pendingWatch.get(tabId);
    if (!watch || !changeInfo.url) return;
    if (Date.now() > watch.expires) {
      pendingWatch.delete(tabId);
      return;
    }
    const domains = await loadRedirectDomains();
    const hostname = safeHostname(changeInfo.url);
    if (hostname && matchesKnownRedirectDomain(hostname, domains)) {
      pendingWatch.delete(tabId);
      await closeSilently(tabId, watch.openerTabId);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    pendingWatch.delete(tabId);
  });
}

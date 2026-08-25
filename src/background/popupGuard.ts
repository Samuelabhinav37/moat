// Safety net behind mainWorldGuard.ts: closes any newly-created tab that
// lands on a domain from the AdGuard Popups / URL Tracking filters, in case
// the popup was opened somewhere our content script never ran (e.g. a PDF
// viewer, or a race on a very slow frame).
import browser from "webextension-polyfill";
import { recordDynamicCatch } from "./blockStats";
import { matchesKnownRedirectDomain, safeHostname } from "./redirectDomainMatch";

// Bundled-at-build-time baseline (loaded once, never changes at runtime)
// plus the live slice liveUpdates.ts refreshes daily -- kept as two sets so
// the live refresh can be a wholesale replace (below) without ever losing
// the baseline.
let baselineDomains: Set<string> | null = null;
let liveDomains = new Set<string>();
let combinedDomains: Set<string> | null = null;

async function loadBaselineDomains(): Promise<Set<string>> {
  if (baselineDomains) return baselineDomains;
  const url = browser.runtime.getURL("rules/redirect-domains.json");
  const list = (await (await fetch(url)).json()) as string[];
  baselineDomains = new Set(list);
  return baselineDomains;
}

function rebuildCombinedDomains(): Set<string> {
  combinedDomains = new Set([...(baselineDomains ?? []), ...liveDomains]);
  return combinedDomains;
}

async function loadRedirectDomains(): Promise<Set<string>> {
  await loadBaselineDomains();
  return combinedDomains ?? rebuildCombinedDomains();
}

/** Replaces (not merges) the live slice of the tab safety net's domain set.
 * liveUpdates.ts fetches the *current, full* list on every refresh, not a
 * diff -- merging into a Set forever would mean a domain removed upstream
 * (e.g. a fixed false positive) stays blocked locally until the worker
 * restarts, instead of actually going away. */
export async function addLiveRedirectDomains(domains: string[]): Promise<void> {
  await loadBaselineDomains();
  liveDomains = new Set(domains);
  rebuildCombinedDomains();
}

async function closeSilently(tabId: number, openerTabId: number | undefined): Promise<void> {
  try {
    await browser.tabs.remove(tabId);
  } catch {
    // Already closed by the time we got here -- nothing to do.
  }
  if (openerTabId !== undefined) await recordDynamicCatch(openerTabId);
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

// Per-tab "which Athena-policy-blocked hostname sent this tab to
// warning.html" record. Needed because the actual redirect (see
// athenaPolicyRules.ts) happens entirely inside declarativeNetRequest --
// the extension only learns a block is *about to* happen via
// webNavigation.onBeforeNavigate (see index.ts), which fires with the
// original requested URL before the redirect resolves. By the time
// warning.html asks "why am I here", the tab's own URL is already
// warning.html itself, not the original target -- this map is the only
// place that original hostname survives to be asked about. Same in-memory,
// per-tab Map pattern as badge.ts/matchStats.ts, cleared via the same
// tabMapCleanup helper.
import { clearTabFromMaps } from "./tabMapCleanup";

const blockedHostnameByTab = new Map<number, string>();

export function recordBlockedHostname(tabId: number, hostname: string): void {
  blockedHostnameByTab.set(tabId, hostname);
}

export function getBlockedHostname(tabId: number): string | null {
  return blockedHostnameByTab.get(tabId) ?? null;
}

export function forgetTab(tabId: number): void {
  clearTabFromMaps(tabId, blockedHostnameByTab);
}

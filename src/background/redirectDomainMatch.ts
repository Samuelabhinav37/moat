// Pulled out of popupGuard.ts (which imports webextension-polyfill and has
// listener side effects) so this pure matching logic is importable in tests
// without needing a browser environment.

/** True if hostname is, or is a subdomain of, an entry in domains. */
export function matchesKnownRedirectDomain(hostname: string, domains: Set<string>): boolean {
  const labels = hostname.split(".");
  for (let i = 0; i < labels.length - 1; i += 1) {
    if (domains.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

export function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

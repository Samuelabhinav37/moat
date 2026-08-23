// Pulled out of popupGuard.ts (which imports webextension-polyfill and has
// listener side effects) so this pure matching logic is importable in tests
// without needing a browser environment.
import { domainChain } from "../shared/domainChain";

/** True if hostname is, or is a subdomain of, an entry in domains. */
export function matchesKnownRedirectDomain(hostname: string, domains: Set<string>): boolean {
  return domainChain(hostname).some((domain) => domains.has(domain));
}

export function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

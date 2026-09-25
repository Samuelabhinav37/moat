// Pure matching logic for Firefox-only CNAME uncloaking (see
// background/cnameUncloak.ts), pulled out so it's importable in tests
// without a browser environment -- same reasoning as redirectDomainMatch.ts.
import { domainChain } from "../shared/domainChain";
import { matchesKnownRedirectDomain } from "./redirectDomainMatch";

/** True if a resolved canonical name is, or is a subdomain of, a known
 * CNAME-cloak destination (see rules/cname-cloak-destinations.json, sourced
 * from AdGuard's cname-trackers list). Identical semantics to
 * matchesKnownRedirectDomain -- re-exported under this name so call sites
 * read as what they mean, not as a coincidental reuse. */
export const isCnameCloakDestination = matchesKnownRedirectDomain;

/**
 * Only hostnames that look like a subdomain of the page you're actually on
 * are candidates for uncloaking -- that's the entire cloaking technique
 * (disguise a third party as a subdomain of the first-party site). A
 * request to a domain that doesn't share the page's own apex is already
 * visibly third-party to every other part of Moat (the 274k static rules
 * already see and can block it directly), so resolving its CNAME chain
 * would just be a DNS lookup that can never change the outcome.
 *
 * Compares the *last* domain-chain entry (the least-specific non-bare-TLD
 * suffix, e.g. "example.com" for "a.b.example.com") rather than doing full
 * public-suffix-list-aware eTLD+1 resolution -- Moat doesn't use a PSL
 * anywhere else in the codebase either (see domainChain.ts's own doc
 * comment), so this is a known, accepted imprecision for multi-part TLDs
 * (e.g. "foo.example.co.uk" and "bar.other.co.uk" would incorrectly share
 * "co.uk" as their apex) rather than a new inconsistency.
 */
export function isCandidateForUncloak(requestHostname: string, pageHostname: string): boolean {
  const requestApex = domainChain(requestHostname).at(-1);
  const pageApex = domainChain(pageHostname).at(-1);
  return requestApex !== undefined && requestApex === pageApex;
}

/** The hostname of the page a request was made from, or null when there's
 * nothing to uncloak: the request is a page navigation itself, or the page
 * is unknown.
 *
 * Until 0.11.131 both paths skipped `frameId === 0` instead, but frameId 0
 * means "made in the top-level frame", so every script and image the main
 * page loads was skipped and only iframe requests were ever checked. Chrome's
 * webRequest also has no `documentUrl` (verified in Chrome for Testing 154:
 * a top-page request carries only `initiator`), so the Chrome path never
 * checked anything at all. */
export function pageHostnameForRequest(details: { type: string; documentUrl?: string; initiator?: string }): string | null {
  if (details.type === "main_frame") return null;
  const pageUrl = details.documentUrl ?? details.initiator;
  if (!pageUrl) return null;
  try {
    return new URL(pageUrl).hostname || null;
  } catch {
    return null;
  }
}

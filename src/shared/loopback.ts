// This computer's own addresses. Terminal sign-ins (claude, gh, gcloud, ...)
// finish on a localhost callback page, and local development servers run
// here too. Moat leaves them alone entirely: no blocking, no headers, no
// page scripts. Privacy Badger does the same (its data/dnr/ignore.json).
// Field report 2026-10-14: sign-ins from the terminal kept failing with Moat
// on, and its stats showed a block on a 127.0.0.1 callback page.

/** As declarativeNetRequest requestDomains entries. Chrome matches these and
 * their subdomains (app.localhost), checked with testMatchOutcome. */
export const LOOPBACK_REQUEST_DOMAINS = ["localhost", "127.0.0.1", "[::1]"];

/** Content-script match patterns for the same hosts, for excludeMatches.
 * All four accepted by scripting.registerContentScripts (checked in Chrome). */
export const LOOPBACK_MATCH_PATTERNS = ["*://localhost/*", "*://*.localhost/*", "*://127.0.0.1/*", "*://[::1]/*"];

/** True for localhost, *.localhost, 127.x.x.x and [::1] (as location.hostname
 * and URL.hostname spell it). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "[::1]" ||
    host === "::1"
  );
}

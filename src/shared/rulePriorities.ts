// declarativeNetRequest priority bands. DNR applies the highest-priority rule
// that matches, and an allowAllRequests rule on a page's frame at priority P
// lets every request in that frame through unless a rule above P matches.
// So the order of these bands is the whole policy:
//
//   bundled ads / trackers / annoyances   <= 1,100,201 (AdGuard's own range)
//   user "Never block" (allow)               1,200,000
//   paused site (allowAllRequests)           1,300,000
//   bundled security lists                   original + 2,000,000
//   enterprise managed blocks / Athena       4,000,000
//
// Pausing a site or adding it to "Never block" beats every ad and tracker
// rule, but known phishing/malware/scam domains stay blocked either way,
// and an organisation's own policy beats everything. scripts/update-filters.mjs
// shifts the security rulesets into their band at build time, and
// scripts/validate-rules.mjs fails the build if any bundled rule lands in the
// wrong band.

/** Highest priority any bundled non-security rule may have. */
export const BUNDLED_NON_SECURITY_MAX_PRIORITY = 1_199_999;
export const NEVER_BLOCK_PRIORITY = 1_200_000;
export const PAUSE_PRIORITY = 1_300_000;
/** Added to every rule in a "security" category ruleset at build time. */
export const SECURITY_PRIORITY_OFFSET = 2_000_000;
export const ENTERPRISE_PRIORITY = 4_000_000;

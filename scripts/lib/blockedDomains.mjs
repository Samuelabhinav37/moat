// Reads the plain "block this domain and its subdomains" rules out of a DNR
// ruleset. The code lives in src/shared/blockedDomains.ts, shared with CNAME
// uncloaking at runtime. Build-time users:
// - update-filters.mjs prunes oisd domains the `ads` group already blocks, so
//   the Standard preset fits Chrome's static-rule limit (see the oisd section).
// - pbTrackerRules.mjs and adRules.mjs check what's already blocked.

export { isBlockedByDomainChain, plainBlockedDomains } from "../../src/shared/blockedDomains.ts";

// Turns the vendored jarelllama/Scam-Blocklist domains (rules/dnr/scam-blocklist-domains.json,
// written by scripts/vendor-scam-blocklist.mjs) into DNR block rules. Unlike
// circumventionServiceRules.mjs's domains (legitimate ad-tech vendors being
// misused, where a direct navigation should still resolve), these are
// confirmed scam/phishing domains with no legitimate direct-navigation use
// case -- main_frame is included on purpose, the same as the
// unlimitedadblocker.pro quick-fix and known-popup-scam-domains.json entries
// this list is meant to make future incidents like that unnecessary for.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const domainsPath = join(__dirname, "..", "..", "rules", "dnr", "scam-blocklist-domains.json");

export function loadScamBlocklistDomains() {
  return JSON.parse(readFileSync(domainsPath, "utf8"));
}

function domainBlockRule(id, domain) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: [
        "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
        "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
      ],
    },
  };
}

export function buildScamBlocklistRules(domains = loadScamBlocklistDomains()) {
  return domains.map((domain, index) => domainBlockRule(index + 1, domain));
}

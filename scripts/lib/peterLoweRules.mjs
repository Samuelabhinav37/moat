// Turns the vendored Peter Lowe's Ad and tracking server list domains
// (rules/dnr/peter-lowe-domains.json, written by update-filters.mjs's own
// fetch step) into DNR block rules. A long-running (since 2003), small,
// hand-curated ad-server list -- independent redundancy alongside AdGuard's
// own Ads/Tracking filters and jarelllama/Scam-Blocklist, same "more than one
// maintainer's list" reasoning as scamBlocklistRules.mjs. Same resourceTypes
// shape as that file too: these are ad/tracking server domains with no
// legitimate direct-navigation use case, so main_frame/sub_frame are
// included rather than excluded (contrast circumventionServiceRules.mjs,
// whose domains are legitimate ad-tech vendors a direct navigation should
// still resolve to).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const domainsPath = join(__dirname, "..", "..", "rules", "dnr", "peter-lowe-domains.json");

export function loadPeterLoweDomains() {
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

export function buildPeterLoweRules(domains = loadPeterLoweDomains()) {
  return domains.map((domain, index) => domainBlockRule(index + 1, domain));
}

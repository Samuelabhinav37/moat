// Turns the vendored oisd "small" domains (rules/dnr/oisd-domains.json,
// written by update-filters.mjs's own fetch step) into DNR block rules. oisd
// is a community-maintained aggregate of dozens of independent ad/tracker/
// malware/scam source lists (see https://oisd.nl) -- broader than any single
// source Moat already ships, which is exactly the redundant-coverage
// reasoning behind adding it. Deliberately kept as its own Filter Lists
// toggle rather than folded into an existing group the way
// scamBlocklistRules.mjs/peterLoweRules.mjs are: at ~56,000 domains it's
// large enough, and broad/aggressive enough by design, that a user who hits
// a real breakage from it should be able to turn it off on its own without
// also giving up core tracker/ad blocking. Same resourceTypes shape as
// scamBlocklistRules.mjs for the same reason: these domains have no
// legitimate direct-navigation use case.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const domainsPath = join(__dirname, "..", "..", "rules", "dnr", "oisd-domains.json");

export function loadOisdDomains() {
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

export function buildOisdRules(domains = loadOisdDomains()) {
  return domains.map((domain, index) => domainBlockRule(index + 1, domain));
}

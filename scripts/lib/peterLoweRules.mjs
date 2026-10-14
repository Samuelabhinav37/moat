// Turns the vendored Peter Lowe's Ad and tracking server list domains
// (rules/dnr/peter-lowe-domains.json, written by update-filters.mjs's own
// fetch step) into DNR block rules. A long-running (since 2003), small,
// hand-curated ad-server list -- independent redundancy alongside AdGuard's
// own Ads/Tracking filters and HaGeZi Fake, same "more than one
// maintainer's list" reasoning as scamBlocklistRules.mjs.
//
// Everything but main_frame: a page you open yourself is never blocked by an
// ad or tracker list. The list has about 150 email click-trackers
// (click.discord.com, awstrack.me, t.co...), and blocking those as pages put
// Moat's block page between people and the links in their email (field
// report 2026-10-14). Opened as a page, the link goes through the tracker to
// where it leads, and the security lists still check that destination.
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
        "sub_frame", "stylesheet", "script", "image", "font",
        "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
      ],
    },
  };
}

export function buildPeterLoweRules(domains = loadPeterLoweDomains()) {
  return domains.map((domain, index) => domainBlockRule(index + 1, domain));
}

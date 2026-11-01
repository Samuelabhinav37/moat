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
// also giving up core tracker/ad blocking.
//
// Everything but main_frame, like peterLoweRules.mjs and for the same
// reason: about 500 of its domains are email click-trackers, and a page you
// open yourself is never blocked by an ad or tracker list. Dangerous sites
// are the security lists' job; they keep blocking pages.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const domainsPath = join(__dirname, "..", "..", "rules", "dnr", "oisd-domains.json");

export const OISD_URL = "https://small.oisd.nl/";
/** "Small" has held about 56,000 domains; far fewer means a format change. */
export const OISD_MIN_DOMAINS = 20000;
const OISD_LINE_PATTERN = /^\|\|([a-z0-9.-]+)\^$/i;
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** The plain `||domain^` lines of oisd's list, lowercased, deduped, sorted.
 * Anything else (modifiers, exceptions) is skipped, never guessed at. */
export function parseOisdList(text) {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => OISD_LINE_PATTERN.exec(line.trim())?.[1]?.toLowerCase())
        .filter((domain) => domain && HOST_PATTERN.test(domain))
    ),
  ].sort();
}

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
        "sub_frame", "stylesheet", "script", "image", "font",
        "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other",
      ],
    },
  };
}

export function buildOisdRules(domains = loadOisdDomains()) {
  return domains.map((domain, index) => domainBlockRule(index + 1, domain));
}

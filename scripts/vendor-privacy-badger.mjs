// Vendors Privacy Badger's trained tracker data (EFF, GPL-3.0 -- see
// NOTICE.md) for two of Moat's rulesets (scripts/update-filters.mjs):
//   - cookieblock: domains Privacy Badger lets load but strips of cookies
//     (they track, and blocking them breaks sites). ruleset_tracker-cookies.
//   - block: domains its crawler (Badger Sett) saw tracking across sites.
//     Measured 2026-10-14: Moat's lists missed 1,875 of the 3,098.
//   - entities: groups of sites owned by one company (google.com and
//     youtube.com, ...), so a company's own sites never count as third
//     parties to each other.
// Privacy Badger ships this data to every user by default ("remote
// learning"), so it's tested at scale.
//
// rules/privacy-badger.json is the committed last good result; builds use it,
// with a CI warning, if GitHub can't be reached.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchWithRetry } from "./lib/fetchWithRetry.mjs";
import { fetchAndVendor } from "./lib/vendorFetch.mjs";
import { parseEntityGroups, parseSeedActions, validatePrivacyBadgerData } from "./lib/privacyBadgerData.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Written where update-filters.mjs reads it; it empties rules/dnr/ itself.
const outFile = join(__dirname, "..", "rules", "privacy-badger.json");
const snapshotFile = join(__dirname, "..", "rules", "privacy-badger.json");

const RAW = "https://raw.githubusercontent.com/EFForg/privacybadger/master/src";
const SEED_URL = `${RAW}/data/seed.json`;
const ENTITIES_URL = `${RAW}/js/multiDomainFirstParties.js`;

// fetchAndVendor takes one URL; the entity groups are a second file, fetched
// first and folded in by parse. If that fetch fails, so does the whole
// vendor step, and the snapshot is used for both together.
let entitiesText = null;
try {
  const response = await fetchWithRetry(ENTITIES_URL);
  if (response.ok) entitiesText = await response.text();
} catch {
  // Leave null: parse throws below, unless the seed fetch also fails and the snapshot is used.
}

const data = await fetchAndVendor({
  url: SEED_URL,
  describe: "Privacy Badger seed data",
  outFile,
  snapshotFile,
  parse: (text) => {
    if (entitiesText === null) throw new Error(`couldn't fetch ${ENTITIES_URL}`);
    return { ...parseSeedActions(JSON.parse(text)), entities: parseEntityGroups(entitiesText) };
  },
  validate: validatePrivacyBadgerData,
});

console.log(
  `privacy-badger.json: ${data.block.length} tracker domains, ${data.cookieblock.length} cookie-blocked, ${data.entities.length} company site groups`
);

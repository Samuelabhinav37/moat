// Vendors Privacy Badger's trained tracker data (EFF, GPL-3.0 -- see
// NOTICE.md) for two of Moat's rulesets (scripts/update-filters.mjs):
//   - cookieblock: domains Privacy Badger lets load but strips of cookies
//     (they track, and blocking them breaks sites). ruleset_tracker-cookies.
//   - block: domains its crawler (Badger Sett) saw tracking across sites.
//     Measured 2026-10-14: Moat's lists missed 1,875 of the 3,098.
//   - entities: groups of sites owned by one company (google.com and
//     youtube.com, ...), so a company's own sites never count as third
//     parties to each other.
//   - yellowlist and site fixes (pbconfig.json): trackers sites need, which
//     Privacy Badger strips of cookies instead of blocking, everywhere or on
//     the listed sites.
//   - widgetDomains (socialwidgets.json): embeds Privacy Badger swaps for a
//     click-to-load button. Moat has no button yet, so it doesn't block them.
// Privacy Badger ships this data to every user by default ("remote
// learning"), so it's tested at scale.
//
// rules/privacy-badger.json is the committed last good result; builds use it,
// with a CI warning, if GitHub can't be reached.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchWithRetry } from "./lib/fetchWithRetry.mjs";
import { fetchAndVendor } from "./lib/vendorFetch.mjs";
import { parseConfig, parseEntityGroups, parseSeedActions, parseWidgetDomains, validatePrivacyBadgerData } from "./lib/privacyBadgerData.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Written where update-filters.mjs reads it; it empties rules/dnr/ itself.
const outFile = join(__dirname, "..", "rules", "privacy-badger.json");
const snapshotFile = join(__dirname, "..", "rules", "privacy-badger.json");

const RAW = "https://raw.githubusercontent.com/EFForg/privacybadger/master/src";
const SEED_URL = `${RAW}/data/seed.json`;
const ENTITIES_URL = `${RAW}/js/multiDomainFirstParties.js`;
const CONFIG_URL = `${RAW}/data/pbconfig.json`;
const WIDGETS_URL = `${RAW}/data/socialwidgets.json`;

// fetchAndVendor takes one URL; the other files are fetched first and folded
// in by parse. If one fails, so does the whole vendor step, and the snapshot
// is used for all of them together.
async function fetchText(url) {
  try {
    const response = await fetchWithRetry(url);
    return response.ok ? await response.text() : null;
  } catch {
    return null; // parse throws below, unless the seed fetch also fails and the snapshot is used.
  }
}
const [entitiesText, configText, widgetsText] = await Promise.all([fetchText(ENTITIES_URL), fetchText(CONFIG_URL), fetchText(WIDGETS_URL)]);

const data = await fetchAndVendor({
  url: SEED_URL,
  describe: "Privacy Badger seed data",
  outFile,
  snapshotFile,
  parse: (text) => {
    for (const [body, url] of [[entitiesText, ENTITIES_URL], [configText, CONFIG_URL], [widgetsText, WIDGETS_URL]]) {
      if (body === null) throw new Error(`couldn't fetch ${url}`);
    }
    return {
      ...parseSeedActions(JSON.parse(text)),
      entities: parseEntityGroups(entitiesText),
      ...parseConfig(JSON.parse(configText)),
      widgetDomains: parseWidgetDomains(JSON.parse(widgetsText)),
    };
  },
  validate: validatePrivacyBadgerData,
});

console.log(
  `privacy-badger.json: ${data.block.length} tracker domains, ${data.cookieblock.length} cookie-blocked, ` +
    `${data.yellowlist.length} yellowlisted, ${Object.keys(data.siteFixes).length} site fixes, ` +
    `${data.widgetDomains.length} widget domains, ${data.entities.length} company site groups`
);

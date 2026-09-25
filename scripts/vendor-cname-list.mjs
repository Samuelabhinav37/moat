// Vendors a public list of CNAME-cloak destinations (the tracker domains that
// "disguised" first-party subdomains point at) for CNAME uncloaking
// (src/background/cnameUncloak.ts on Firefox, cnameUncloakChrome.ts's DoH path
// on Chrome). Unlike the daily-refreshed redirect-domains list
// (background/liveUpdates.ts), this one only refreshes when this script is
// re-run and a new build ships -- a reasonable scope reduction for a niche,
// opt-in feature whose source list itself changes rarely.
//
// Source: AdGuard's cname-trackers "original trackers" list (MIT --
// https://github.com/AdguardTeam/cname-trackers). Until 0.11.129 this was
// NextDNS's nextdns/cname-cloaking-blocklist, which went away on 2026-09-25
// (GitHub 404 for the repo and the raw file). AdGuard's list covered 33 of
// NextDNS's final 35 domains; the other two are kept below so switching
// sources never drops coverage.
//
// rules/cname-cloak-destinations.json is the committed last good result.
// fetchAndVendor refreshes it on every good fetch, and builds from it (with a
// CI warning) if AdGuard's file ever can't be reached either.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchAndVendor } from "./lib/vendorFetch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = join(__dirname, "..", "rules", "dnr", "cname-cloak-destinations.json");
const snapshotFile = join(__dirname, "..", "rules", "cname-cloak-destinations.json");

const SOURCE_URL = "https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_original_trackers_justdomains.txt";

// From NextDNS's final list (MIT, see NOTICE.md), not in AdGuard's.
const NEXTDNS_ONLY_DOMAINS = ["hs.eloqua.com", "k.madmetrics.com"];

// AdGuard's list had 93 domains when this was written. A sudden collapse
// means the file changed shape, not that the trackers went away.
const MIN_EXPECTED_DOMAINS = 50;
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const domains = await fetchAndVendor({
  url: SOURCE_URL,
  describe: "AdGuard cname-trackers list",
  outFile,
  snapshotFile,
  parse: (text) => [
    ...new Set([
      ...text
        .split("\n")
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!")),
      ...NEXTDNS_ONLY_DOMAINS,
    ]),
  ].sort(),
  validate: (domains) => {
    if (domains.length < MIN_EXPECTED_DOMAINS) {
      throw new Error(
        `AdGuard cname-trackers list parsed to only ${domains.length} domains -- refusing to ship a suspiciously small list.`
      );
    }
    const bad = domains.filter((domain) => !HOSTNAME.test(domain));
    if (bad.length > 0) {
      throw new Error(`AdGuard cname-trackers list has entries that aren't plain hostnames: ${bad.slice(0, 5).join(", ")}`);
    }
  },
});

console.log(`Vendored ${domains.length} CNAME-cloak destination domain(s) -> rules/dnr/cname-cloak-destinations.json`);

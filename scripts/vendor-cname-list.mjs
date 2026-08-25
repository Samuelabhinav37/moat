// Vendors NextDNS's public CNAME-cloaking destination list (MIT-licensed --
// https://github.com/nextdns/cname-cloaking-blocklist) for Firefox-only
// CNAME uncloaking (src/background/cnameUncloak.ts). Unlike the daily-
// refreshed redirect-domains list (background/liveUpdates.ts), this one
// only refreshes when this script is re-run and a new build ships -- a
// reasonable scope reduction for a niche, opt-in, Firefox-only feature
// whose source list itself changes rarely.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchAndVendor } from "./lib/vendorFetch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = join(__dirname, "..", "rules", "dnr", "cname-cloak-destinations.json");

const SOURCE_URL = "https://raw.githubusercontent.com/nextdns/cname-cloaking-blocklist/master/domains";

const domains = await fetchAndVendor({
  url: SOURCE_URL,
  describe: "NextDNS cname-cloaking-blocklist",
  outFile,
  parse: (text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .sort(),
  validate: (domains) => {
    if (domains.length === 0) {
      throw new Error("NextDNS cname-cloaking-blocklist parsed to zero domains -- refusing to ship an empty list.");
    }
  },
});

console.log(`Vendored ${domains.length} CNAME-cloak destination domain(s) -> rules/dnr/cname-cloak-destinations.json`);

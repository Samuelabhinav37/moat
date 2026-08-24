// Vendors NextDNS's public CNAME-cloaking destination list (MIT-licensed --
// https://github.com/nextdns/cname-cloaking-blocklist) for Firefox-only
// CNAME uncloaking (src/background/cnameUncloak.ts). Unlike the daily-
// refreshed redirect-domains list (background/liveUpdates.ts), this one
// only refreshes when this script is re-run and a new build ships -- a
// reasonable scope reduction for a niche, opt-in, Firefox-only feature
// whose source list itself changes rarely.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "rules", "dnr");

const SOURCE_URL = "https://raw.githubusercontent.com/nextdns/cname-cloaking-blocklist/master/domains";

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to fetch NextDNS cname-cloaking-blocklist: ${response.status} ${response.statusText}`);
}
const text = await response.text();

const domains = text
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

if (domains.length === 0) {
  throw new Error("NextDNS cname-cloaking-blocklist parsed to zero domains -- refusing to ship an empty list.");
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "cname-cloak-destinations.json"), JSON.stringify(domains.sort()));

console.log(`Vendored ${domains.length} CNAME-cloak destination domain(s) -> rules/dnr/cname-cloak-destinations.json`);

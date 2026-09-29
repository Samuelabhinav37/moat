// Writes rules/dnr/ad-rules.json: the tracking-list rules that stop an ad
// server, so the popup counts those blocks as ads (see scripts/lib/adRules.mjs).
// Runs in filters:update after pack-rules.mjs, because packing merges and
// renumbers single-site rules; ids read before packing would be stale.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeAdRules } from "./lib/adRules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "rules", "dnr");
const read = (file) => JSON.parse(readFileSync(join(dir, file), "utf8"));
const adDomains = new Set([
  ...read("uncloak-domains.json").ads,
  ...JSON.parse(readFileSync(join(root, "rules", "ad-networks.json"), "utf8")),
]);
const adRules = computeAdRules(read("manifest.json"), read, adDomains);
writeFileSync(join(dir, "ad-rules.json"), JSON.stringify(adRules));
console.log(`ad-rules.json: ${Object.values(adRules).reduce((sum, ids) => sum + ids.length, 0)} tracking-list rules that stop an ad server`);

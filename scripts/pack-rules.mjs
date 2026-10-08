// Packs each generated ruleset's plain domain blocks into requestDomains
// rules (see scripts/lib/packDomainRules.mjs), in place in rules/dnr/, and
// updates the rule counts in rules/dnr/manifest.json. Runs as part of
// `npm run filters:update`, after update-filters.mjs.
//
// The unpacked rulesets are kept in rules/dnr-unpacked/ (gitignored, like
// rules/dnr/) so scripts/check-rule-packing.mjs can load both into Chrome
// and prove they block the same things. Running it again on packed rules
// changes nothing.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packDomainRules } from "./lib/packDomainRules.mjs";
import { splitFetchableRedirects } from "./lib/fetchableRedirects.mjs";
import { isRetryLoopStubRule } from "./lib/retryLoopStubRules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rulesDir = join(root, "rules", "dnr");
const unpackedDir = join(root, "rules", "dnr-unpacked");

// Written after packing. A second run (filters:update's own chain plus a
// manual run, say) must not replace the unpacked copy with packed rules.
const marker = join(rulesDir, ".packed");
if (existsSync(marker)) {
  console.log("rules/dnr is already packed; nothing to do.");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(join(rulesDir, "manifest.json"), "utf8"));
const ruleCompanies = JSON.parse(readFileSync(join(rulesDir, "rule-companies.json"), "utf8"));

rmSync(unpackedDir, { recursive: true, force: true });
mkdirSync(unpackedDir, { recursive: true });

let before = 0;
let after = 0;
let packedDomains = 0;
let fetchBlocks = 0;
for (const entry of manifest) {
  const path = join(rulesDir, entry.file);
  // Stand-in files never answer fetch()/XHR (see fetchableRedirects.mjs).
  // Done before the unpacked copy, so check-rule-packing compares like with like.
  const standIns = splitFetchableRedirects(JSON.parse(readFileSync(path, "utf8")), isRetryLoopStubRule);
  const rules = standIns.rules;
  fetchBlocks += standIns.converted + standIns.split;
  writeFileSync(join(unpackedDir, entry.file), JSON.stringify(rules));
  // Rules a company is attributed to keep their own id (matchStats.ts maps
  // a matched rule id to its company).
  const keepIds = new Set(Object.keys(ruleCompanies[entry.id] ?? {}).map(Number));
  const result = packDomainRules(rules, { keepIds });
  writeFileSync(path, JSON.stringify(result.rules));
  before += rules.length;
  after += result.rules.length;
  packedDomains += result.packedFrom;
  // ruleCount is what Chrome counts against its limit; entryCount is how
  // many filter entries the list has, which is what Settings shows.
  entry.entryCount = rules.length;
  entry.ruleCount = result.rules.length;
}
cpSync(join(rulesDir, "manifest.json"), join(unpackedDir, "manifest.json"));
writeFileSync(join(rulesDir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(
  `Packed ${packedDomains.toLocaleString()} domain rules: ${before.toLocaleString()} -> ${after.toLocaleString()} rules ` +
    `(unpacked copy in rules/dnr-unpacked/ for check-rule-packing)`
);
console.log(`Kept ${fetchBlocks} stand-in redirect(s) off fetch()/XHR`);
writeFileSync(marker, "");

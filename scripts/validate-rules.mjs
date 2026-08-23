// Sanity-checks the generated DNR rulesets before they ship: valid JSON,
// only schema-legal top-level keys, and no duplicate rule ids within a
// file (DNR requires uniqueness per-ruleset, not globally). Run after
// `npm run filters:update`, before building.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesDir = join(__dirname, "..", "rules", "dnr");
const ALLOWED_KEYS = new Set(["id", "priority", "action", "condition"]);

const manifest = JSON.parse(readFileSync(join(rulesDir, "manifest.json"), "utf8"));

let totalRules = 0;
let ok = true;

for (const entry of manifest) {
  const rules = JSON.parse(readFileSync(join(rulesDir, entry.file), "utf8"));
  const ids = new Set();

  for (const rule of rules) {
    for (const key of Object.keys(rule)) {
      if (!ALLOWED_KEYS.has(key)) {
        console.error(`${entry.file}: rule ${rule.id} has non-schema key "${key}"`);
        ok = false;
      }
    }
    if (ids.has(rule.id)) {
      console.error(`${entry.file}: duplicate rule id ${rule.id}`);
      ok = false;
    }
    ids.add(rule.id);
  }

  if (rules.length !== entry.ruleCount) {
    console.error(`${entry.file}: manifest says ${entry.ruleCount} rules, file has ${rules.length}`);
    ok = false;
  }

  totalRules += rules.length;
  console.log(`${entry.file}: ${rules.length} rules, ${ids.size} unique ids`);
}

console.log(`\n${manifest.length} rulesets, ${totalRules} total rules`);

const cosmeticsManifest = JSON.parse(readFileSync(join(rulesDir, "cosmetics-manifest.json"), "utf8"));
const meta = JSON.parse(readFileSync(join(rulesDir, cosmeticsManifest.meta), "utf8"));
if (!Array.isArray(meta.generic)) {
  console.error(`${cosmeticsManifest.meta}: "generic" must be an array`);
  ok = false;
}

let domainCount = 0;
let perDomainCount = 0;
const seenDomains = new Set();
for (const file of cosmeticsManifest.domainShards) {
  const shard = JSON.parse(readFileSync(join(rulesDir, file), "utf8"));
  for (const [domain, selectors] of Object.entries(shard)) {
    if (seenDomains.has(domain)) {
      console.error(`${file}: domain "${domain}" also appears in another shard`);
      ok = false;
    }
    seenDomains.add(domain);
    domainCount += 1;
    perDomainCount += selectors.length;
  }
}

const exceptionCount = Object.values(meta.exceptions ?? {}).reduce((sum, s) => sum + s.length, 0);
console.log(
  `cosmetics: ${meta.generic.length} generic, ${perDomainCount} domain-scoped selectors ` +
    `across ${domainCount} domains (${cosmeticsManifest.domainShards.length} shard file(s)), ${exceptionCount} exceptions`
);

if (!ok) {
  console.error("\nValidation failed.");
  process.exit(1);
}

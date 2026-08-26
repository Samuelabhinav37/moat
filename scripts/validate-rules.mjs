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
// Chrome's declarativeNetRequest.RuleActionType enum -- a rule with a legal
// top-level shape but an illegal action.type value would otherwise pass this
// validator and only fail at runtime with a cryptic browser-level error.
const ALLOWED_ACTION_TYPES = new Set(["block", "redirect", "allow", "upgradeScheme", "modifyHeaders", "allowAllRequests"]);

const manifest = JSON.parse(readFileSync(join(rulesDir, "manifest.json"), "utf8"));
const VALID_CATEGORIES = new Set(["ads", "security", "annoyance", "core"]);

let totalRules = 0;
let ok = true;
const rulesetRuleIds = new Map();

for (const entry of manifest) {
  if (!entry.group) {
    console.error(`${entry.id}: missing "group"`);
    ok = false;
  }
  if (!VALID_CATEGORIES.has(entry.category)) {
    console.error(`${entry.id}: missing or unknown "category" (${entry.category})`);
    ok = false;
  }

  const rules = JSON.parse(readFileSync(join(rulesDir, entry.file), "utf8"));
  const ids = new Set();
  rulesetRuleIds.set(entry.id, new Set(rules.map((r) => r.id)));

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
    if (!ALLOWED_ACTION_TYPES.has(rule.action?.type)) {
      console.error(`${entry.file}: rule ${rule.id} has unknown action.type "${rule.action?.type}"`);
      ok = false;
    }
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
const MAX_CHUNK_BYTES = 4.5 * 1024 * 1024;
for (let i = 0; i < cosmeticsManifest.bucketCount; i += 1) {
  const file = `cosmetics-bucket-${i}.json`;
  const text = readFileSync(join(rulesDir, file), "utf8");
  if (text.length > MAX_CHUNK_BYTES) {
    console.error(`${file}: ${text.length} bytes, over the ${MAX_CHUNK_BYTES}-byte lint limit`);
    ok = false;
  }
  const shard = JSON.parse(text);
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
    `across ${domainCount} domains (${cosmeticsManifest.bucketCount} shard buckets), ${exceptionCount} exceptions`
);

const ruleCompanies = JSON.parse(readFileSync(join(rulesDir, "rule-companies.json"), "utf8"));
let attributedCount = 0;
for (const [rulesetId, byRuleId] of Object.entries(ruleCompanies)) {
  const knownIds = rulesetRuleIds.get(rulesetId);
  if (!knownIds) {
    console.error(`rule-companies.json: unknown rulesetId "${rulesetId}"`);
    ok = false;
    continue;
  }
  for (const ruleId of Object.keys(byRuleId)) {
    attributedCount += 1;
    if (!knownIds.has(Number(ruleId))) {
      console.error(`rule-companies.json: rulesetId "${rulesetId}" has no rule ${ruleId}`);
      ok = false;
    }
  }
}
console.log(`rule-companies.json: ${attributedCount} rules attributed to a company`);

const companyInfo = JSON.parse(readFileSync(join(rulesDir, "company-info.json"), "utf8"));
const attributedCompanies = new Set();
for (const byRuleId of Object.values(ruleCompanies)) {
  for (const company of Object.values(byRuleId)) attributedCompanies.add(company);
}
for (const company of attributedCompanies) {
  if (!(company in companyInfo)) {
    console.error(`company-info.json: missing entry for attributed company "${company}"`);
    ok = false;
  }
}
console.log(`company-info.json: ${Object.keys(companyInfo).length} companies described`);

if (!ok) {
  console.error("\nValidation failed.");
  process.exit(1);
}

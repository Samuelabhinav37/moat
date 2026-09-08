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
// Generic selectors: genericHigh (always-on) is a string array;
// genericByHash maps a token hash to a string array. The "nothing dropped
// in the partition" check lives in update-cosmetics.mjs, which still has the
// flat parser output to compare against.
if (!Array.isArray(meta.genericHigh) || meta.genericHigh.some((s) => typeof s !== "string")) {
  console.error(`${cosmeticsManifest.meta}: "genericHigh" must be an array of strings`);
  ok = false;
}
if (typeof meta.genericByHash !== "object" || meta.genericByHash === null || Array.isArray(meta.genericByHash)) {
  console.error(`${cosmeticsManifest.meta}: "genericByHash" must be an object`);
  ok = false;
} else if (
  Object.values(meta.genericByHash).some((v) => !Array.isArray(v) || v.some((s) => typeof s !== "string"))
) {
  console.error(`${cosmeticsManifest.meta}: every "genericByHash" value must be an array of strings`);
  ok = false;
}

let domainCount = 0;
let perDomainCount = 0;
let injectDomainCount = 0;
let injectPerDomainCount = 0;
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
  // Each domain's entry is { h?: hide-selectors, i?: [selector,declaration]
  // injection pairs } -- both optional, see scripts/update-cosmetics.mjs.
  for (const [domain, entry] of Object.entries(shard)) {
    if (seenDomains.has(domain)) {
      console.error(`${file}: domain "${domain}" also appears in another shard`);
      ok = false;
    }
    seenDomains.add(domain);
    if (entry.h) {
      domainCount += 1;
      perDomainCount += entry.h.length;
    }
    if (entry.i) {
      injectDomainCount += 1;
      injectPerDomainCount += entry.i.length;
    }
  }
}

const exceptionCount = Object.values(meta.exceptions ?? {}).reduce((sum, s) => sum + s.length, 0);
const injectGenericCount = meta.injectGeneric?.length ?? 0;
const genericByHashCount = Object.values(meta.genericByHash ?? {}).reduce((sum, s) => sum + s.length, 0);
console.log(
  `cosmetics: ${meta.genericHigh.length} always-on + ${genericByHashCount} token-anchored generic ` +
    `(${Object.keys(meta.genericByHash ?? {}).length} buckets), ${perDomainCount} domain-scoped selectors ` +
    `across ${domainCount} domains (${cosmeticsManifest.bucketCount} shard buckets), ${exceptionCount} exceptions, ` +
    `${injectGenericCount} generic + ${injectPerDomainCount} domain-scoped CSS-injection rules ` +
    `across ${injectDomainCount} domains`
);

// ad-networks.json: hand-curated (not generated), lives in rules/ not
// rules/dnr. src/content/adCollapse.ts collapses iframe/img whose host is
// one of these. Must be a non-empty array of lowercase, de-duplicated,
// path-free domain strings.
const adNetworks = JSON.parse(readFileSync(join(rulesDir, "..", "ad-networks.json"), "utf8"));
if (!Array.isArray(adNetworks) || adNetworks.length === 0) {
  console.error("ad-networks.json: must be a non-empty array");
  ok = false;
} else {
  const seen = new Set();
  for (const d of adNetworks) {
    if (typeof d !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      console.error(`ad-networks.json: not a bare lowercase domain: ${JSON.stringify(d)}`);
      ok = false;
    } else if (seen.has(d)) {
      console.error(`ad-networks.json: duplicate entry "${d}"`);
      ok = false;
    }
    seen.add(d);
  }
  const sorted = [...adNetworks].sort();
  if (adNetworks.some((d, i) => d !== sorted[i])) {
    console.error("ad-networks.json: entries must be sorted");
    ok = false;
  }
  console.log(`ad-networks.json: ${adNetworks.length} ad-network domains`);
}

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

// company-info.json: name -> { description: string, url: string | null },
// keyed by the same company-name strings rule-companies.json uses. Every key
// must actually appear as an attributed company, or the options "Trackers"
// tab would carry descriptions for companies it can never show.
const attributedCompanyNames = new Set(
  Object.values(ruleCompanies).flatMap((byRuleId) => Object.values(byRuleId))
);
const companyInfo = JSON.parse(readFileSync(join(rulesDir, "company-info.json"), "utf8"));
let describedCount = 0;
for (const [name, entry] of Object.entries(companyInfo)) {
  describedCount += 1;
  if (typeof entry?.description !== "string" || entry.description.length === 0) {
    console.error(`company-info.json: "${name}" has a missing or empty description`);
    ok = false;
  }
  if (entry?.url !== null && typeof entry?.url !== "string") {
    console.error(`company-info.json: "${name}" url must be a string or null`);
    ok = false;
  }
  if (!attributedCompanyNames.has(name)) {
    console.error(`company-info.json: "${name}" is not an attributed company in rule-companies.json`);
    ok = false;
  }
}
console.log(`company-info.json: ${describedCount} companies described`);

if (!ok) {
  console.error("\nValidation failed.");
  process.exit(1);
}

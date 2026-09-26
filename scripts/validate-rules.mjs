// Sanity-checks the generated DNR rulesets before they ship: valid JSON,
// only schema-legal top-level keys, and no duplicate rule ids within a
// file (DNR requires uniqueness per-ruleset, not globally). Run after
// `npm run filters:update`, before building.
import { readFileSync, existsSync } from "node:fs";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LIVE_MANIFEST_PUBLIC_KEY } from "../src/shared/liveSigningKey.ts";
import { PRESETS } from "../src/shared/filterPresets.ts";
import { enabledRuleCount } from "../src/background/filterGroupState.ts";
import { BUNDLED_NON_SECURITY_MAX_PRIORITY, ENTERPRISE_PRIORITY, NEVER_BLOCK_PRIORITY, PAUSE_PRIORITY } from "../src/shared/rulePriorities.ts";

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

// Chrome allows one extension about 330,000 static rules in total (30,000
// guaranteed + a 300,000 pool shared with every other extension). "standard"
// is what a fresh install turns on, so it has to fit on its own with some
// headroom -- otherwise Chrome drops lists on every new install, which is
// exactly what happened until 0.11.130. Fail here instead of shipping that.
// Priority bands (src/shared/rulePriorities.ts): a paused site and "Never
// block" must beat every bundled ad/tracker/annoyance rule, and lose to every
// bundled security rule. An upstream list that ships a rule outside its band
// would quietly break one of those promises, so fail instead.
for (const entry of manifest) {
  const rules = JSON.parse(readFileSync(join(rulesDir, entry.file), "utf8"));
  const priorities = rules.map((rule) => rule.priority ?? 1);
  if (entry.category === "security") {
    const lowest = Math.min(...priorities);
    if (lowest <= PAUSE_PRIORITY) {
      console.error(`${entry.id}: security rule at priority ${lowest}, not above the pause band (${PAUSE_PRIORITY})`);
      ok = false;
    }
    const highest = Math.max(...priorities);
    if (highest >= ENTERPRISE_PRIORITY) {
      console.error(`${entry.id}: security rule at priority ${highest} reaches the enterprise band (${ENTERPRISE_PRIORITY})`);
      ok = false;
    }
  } else {
    const highest = Math.max(...priorities);
    if (highest > BUNDLED_NON_SECURITY_MAX_PRIORITY) {
      console.error(
        `${entry.id}: rule at priority ${highest} reaches the "Never block" band (${NEVER_BLOCK_PRIORITY}); ` +
          "pausing a site or allowing it would no longer beat it"
      );
      ok = false;
    }
  }
}

const FRESH_INSTALL_RULE_CEILING = 320_000;
for (const [name, preset] of Object.entries(PRESETS)) {
  console.log(`preset ${name}: ${enabledRuleCount(manifest, preset.filterGroups)} rules`);
}
const freshInstallRules = enabledRuleCount(manifest, PRESETS.standard.filterGroups);
if (freshInstallRules > FRESH_INSTALL_RULE_CEILING) {
  console.error(
    `The fresh-install preset (standard) needs ${freshInstallRules} rules, over the ${FRESH_INSTALL_RULE_CEILING} ceiling -- ` +
      "Chrome would drop filter lists on every new install. Trim a list or change the preset."
  );
  ok = false;
}

const cosmeticsManifest = JSON.parse(readFileSync(join(rulesDir, "cosmetics-manifest.json"), "utf8"));
const meta = JSON.parse(readFileSync(join(rulesDir, cosmeticsManifest.meta), "utf8"));
// Generic selectors: genericHigh (always-on) is a string array;
// genericByHash maps a token hash to a string array. The "nothing dropped
// in the partition" check lives in update-cosmetics.mjs, which still has the
// flat parser output to compare against.
if (Array.isArray(meta.genericHigh) && meta.genericHigh.some((s) => typeof s === "string" && s.includes(":has("))) {
  console.error(`${cosmeticsManifest.meta}: "genericHigh" contains a :has() selector; those make every DOM change expensive (scripts/lib/genericTokenIndex.mjs)`);
  ok = false;
}
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

// Procedural (extended-selector) rules: { s, t: task[], r?, x } -- generic
// array + per-domain map, both may be absent on an old build.
const VALID_TASK_OPS = new Set(["has-text", "min-text-length", "upward", "upward-sel", "matches-css", "xpath"]);
function validProceduralRule(rule) {
  return (
    rule != null &&
    typeof rule.s === "string" &&
    (rule.x === undefined || typeof rule.x === "string") &&
    Array.isArray(rule.t) &&
    // A task chain, OR a bare `selector:remove()` (t empty, r set).
    (rule.t.length > 0 || rule.r === 1) &&
    rule.t.every((task) => Array.isArray(task) && VALID_TASK_OPS.has(task[0])) &&
    (rule.r === undefined || rule.r === 1)
  );
}
const proceduralGeneric = meta.proceduralGeneric ?? [];
const proceduralPerDomain = meta.proceduralPerDomain ?? {};
if (!Array.isArray(proceduralGeneric) || !proceduralGeneric.every(validProceduralRule)) {
  console.error(`${cosmeticsManifest.meta}: "proceduralGeneric" must be an array of { s, t, x } rules`);
  ok = false;
}
if (typeof proceduralPerDomain !== "object" || proceduralPerDomain === null || Array.isArray(proceduralPerDomain)) {
  console.error(`${cosmeticsManifest.meta}: "proceduralPerDomain" must be an object`);
  ok = false;
} else if (!Object.values(proceduralPerDomain).every((list) => Array.isArray(list) && list.every(validProceduralRule))) {
  console.error(`${cosmeticsManifest.meta}: every "proceduralPerDomain" value must be an array of { s, t, x } rules`);
  ok = false;
}
const proceduralPerDomainCount = Object.values(proceduralPerDomain).reduce((sum, list) => sum + list.length, 0);

console.log(
  `cosmetics: ${meta.genericHigh.length} always-on + ${genericByHashCount} token-anchored generic ` +
    `(${Object.keys(meta.genericByHash ?? {}).length} buckets), ${perDomainCount} domain-scoped selectors ` +
    `across ${domainCount} domains (${cosmeticsManifest.bucketCount} shard buckets), ${exceptionCount} exceptions, ` +
    `${injectGenericCount} generic + ${injectPerDomainCount} domain-scoped CSS-injection rules ` +
    `across ${injectDomainCount} domains, ` +
    `${proceduralGeneric.length} generic + ${proceduralPerDomainCount} domain-scoped procedural rules ` +
    `across ${Object.keys(proceduralPerDomain).length} domains`
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

// seo-spam-domains.json: hand-curated (not generated), lives in rules/ not
// rules/dnr. src/content/searchSlopFilter.ts collapses search results whose
// link host is one of these. Deliberately a small, conservative seed --
// better to under-list than falsely flag a legitimate small site. Must be a
// non-empty array of lowercase, de-duplicated, path-free domain strings.
const seoSpamDomains = JSON.parse(readFileSync(join(rulesDir, "..", "seo-spam-domains.json"), "utf8"));
if (!Array.isArray(seoSpamDomains) || seoSpamDomains.length === 0) {
  console.error("seo-spam-domains.json: must be a non-empty array");
  ok = false;
} else {
  const seen = new Set();
  for (const d of seoSpamDomains) {
    if (typeof d !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      console.error(`seo-spam-domains.json: not a bare lowercase domain: ${JSON.stringify(d)}`);
      ok = false;
    } else if (seen.has(d)) {
      console.error(`seo-spam-domains.json: duplicate entry "${d}"`);
      ok = false;
    }
    seen.add(d);
  }
  const sorted = [...seoSpamDomains].sort();
  if (seoSpamDomains.some((d, i) => d !== sorted[i])) {
    console.error("seo-spam-domains.json: entries must be sorted");
    ok = false;
  }
  console.log(`seo-spam-domains.json: ${seoSpamDomains.length} SEO-spam domains`);
}

// circumvention-services.json: hand-curated (not generated), lives in rules/
// not rules/dnr. scripts/lib/circumventionServiceRules.mjs turns these into
// network block rules. Deliberately a small, conservative seed -- only
// domains independently confirmed as anti-adblock-circumvention service
// vendors, not guessed. Must be a non-empty array of lowercase,
// de-duplicated, path-free domain strings.
const circumventionServices = JSON.parse(
  readFileSync(join(rulesDir, "..", "circumvention-services.json"), "utf8")
);
if (!Array.isArray(circumventionServices) || circumventionServices.length === 0) {
  console.error("circumvention-services.json: must be a non-empty array");
  ok = false;
} else {
  const seen = new Set();
  for (const d of circumventionServices) {
    if (typeof d !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      console.error(`circumvention-services.json: not a bare lowercase domain: ${JSON.stringify(d)}`);
      ok = false;
    } else if (seen.has(d)) {
      console.error(`circumvention-services.json: duplicate entry "${d}"`);
      ok = false;
    }
    seen.add(d);
  }
  const sorted = [...circumventionServices].sort();
  if (circumventionServices.some((d, i) => d !== sorted[i])) {
    console.error("circumvention-services.json: entries must be sorted");
    ok = false;
  }
  console.log(`circumvention-services.json: ${circumventionServices.length} circumvention-service domains`);
}

// known-popup-scam-domains.json: hand-curated (not generated), lives in
// rules/ not rules/dnr. update-filters.mjs merges these into
// redirectDomains (rules/dnr/redirect-domains.json + the live-update copy)
// so popupGuard.ts closes tabs that land on them -- domains independently
// confirmed to redirect to a popup/scam page that AdGuard's own popups/
// url-tracking filters don't happen to catch yet. Must be a non-empty
// array of lowercase, de-duplicated, path-free domain strings.
const knownPopupScamDomains = JSON.parse(
  readFileSync(join(rulesDir, "..", "known-popup-scam-domains.json"), "utf8")
);
if (!Array.isArray(knownPopupScamDomains) || knownPopupScamDomains.length === 0) {
  console.error("known-popup-scam-domains.json: must be a non-empty array");
  ok = false;
} else {
  const seen = new Set();
  for (const d of knownPopupScamDomains) {
    if (typeof d !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      console.error(`known-popup-scam-domains.json: not a bare lowercase domain: ${JSON.stringify(d)}`);
      ok = false;
    } else if (seen.has(d)) {
      console.error(`known-popup-scam-domains.json: duplicate entry "${d}"`);
      ok = false;
    }
    seen.add(d);
  }
  const sorted = [...knownPopupScamDomains].sort();
  if (knownPopupScamDomains.some((d, i) => d !== sorted[i])) {
    console.error("known-popup-scam-domains.json: entries must be sorted");
    ok = false;
  }
  console.log(`known-popup-scam-domains.json: ${knownPopupScamDomains.length} known popup-scam domains`);
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

// uncounted-rules.json: rulesetId -> ids of non-blocking rules the popup
// count skips. A stale id would silently count again, so check them all.
const uncountedRules = JSON.parse(readFileSync(join(rulesDir, "uncounted-rules.json"), "utf8"));
let uncountedCount = 0;
for (const [rulesetId, ruleIds] of Object.entries(uncountedRules)) {
  const knownIds = rulesetRuleIds.get(rulesetId);
  if (!knownIds) {
    console.error(`uncounted-rules.json: unknown rulesetId "${rulesetId}"`);
    ok = false;
    continue;
  }
  for (const ruleId of ruleIds) {
    uncountedCount += 1;
    if (!knownIds.has(ruleId)) {
      console.error(`uncounted-rules.json: rulesetId "${rulesetId}" has no rule ${ruleId}`);
      ok = false;
    }
  }
}
console.log(`uncounted-rules.json: ${uncountedCount} non-blocking rules left out of the popup count`);

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

// live/manifest.json.sig: if a signature file is checked in, it must
// actually verify against LIVE_MANIFEST_PUBLIC_KEY. Before this check
// existed, nothing enforced that a stale or mismatched .sig couldn't ship --
// the runtime (liveSignature.ts) would reject it at fetch time, but only
// after it was already published, and CI would have shown green the whole
// way there. Same Ed25519/SPKI wrapping liveSignature.ts uses, so a
// signature this check accepts is guaranteed to be one the runtime accepts
// too. No signature file at all is fine -- that's today's actual state
// (see update-live-manifest.mjs: no CI workflow sets LIVE_SIGNING_PRIVATE_KEY
// yet), and the live-update channel is designed to run on hash-only trust
// until that changes.
const liveDir = join(__dirname, "..", "live");
const liveSigPath = join(liveDir, "manifest.json.sig");
if (existsSync(liveSigPath)) {
  const manifestBytes = Buffer.from(
    readFileSync(join(liveDir, "manifest.json"), "utf8").replace(/\r\n/g, "\n"),
    "utf8"
  );
  const signature = Buffer.from(readFileSync(liveSigPath, "utf8").trim(), "base64");
  // Fixed 12-byte SPKI/DER prefix for an Ed25519 public key -- identical to
  // liveSignature.ts's ED25519_SPKI_PREFIX, wrapping the raw 32-byte key so
  // Node's createPublicKey (which wants a recognized key format) can import it.
  const ED25519_SPKI_PREFIX = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(LIVE_MANIFEST_PUBLIC_KEY, "base64")]);
  let verified = false;
  try {
    const publicKey = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    verified = edVerify(null, manifestBytes, publicKey, signature);
  } catch (err) {
    console.error(`live/manifest.json.sig: failed to verify (${err.message})`);
  }
  if (!verified) {
    console.error(
      "live/manifest.json.sig exists but does not verify against LIVE_MANIFEST_PUBLIC_KEY -- " +
        "refusing to ship a corrupt or mismatched signature."
    );
    ok = false;
  } else {
    console.log("live/manifest.json.sig: verifies OK");
  }
} else {
  console.log("live/manifest.json.sig: not present (hash-only trust) -- signing not yet configured.");
}

if (!ok) {
  console.error("\nValidation failed.");
  process.exit(1);
}

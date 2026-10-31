// Writes live/ad-domains.json: domains on today's oisd list (the router-style
// list Moat bundles, scripts/lib/oisdRules.mjs) that the latest release
// doesn't already block, so ad blocking keeps up between releases. The
// extension applies them as dynamic rules (src/background/liveAdRules.ts).
// Run by .github/workflows/security-live.yml once a day, after it unzips
// the latest release's chrome.zip:
//   node scripts/update-live-ads.mjs <unzipped release dir>
//
// Same guardrails as the security lists: well-formed hosts only, no IP
// address, public suffix, protected site or shared link host
// (src/shared/liveSecurity.ts), none of the Tranco top 10,000 as a whole,
// and a day adding too much goes to a person (src/shared/liveAds.ts).
//
// Exit codes: 0 = written (or unchanged), 3 = written but needs review,
// 1 = failed (nothing written).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./lib/fetchWithRetry.mjs";
import { loadPopularSites, dropPopularSites } from "./lib/popularSites.mjs";
import { loadPsl, registrableDomain } from "./lib/publicSuffixList.mjs";
import { OISD_MIN_DOMAINS, OISD_URL, parseOisdList } from "./lib/oisdRules.mjs";
import { plainBlockedDomains, isBlockedByDomainChain } from "./lib/blockedDomains.mjs";
import { cleanSecurityDomains } from "../src/shared/liveSecurity.ts";
import { LIVE_ADS_FORMAT, MAX_LIVE_AD_DOMAINS, adChangeNeedsReview } from "../src/shared/liveAds.ts";

/** What the release blocks by domain in the lists the delta extends. */
const BASELINE_GROUPS = new Set(["ads", "trackers", "oisd"]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "live", "ad-domains.json");
const releaseDir = process.argv[2];
if (!releaseDir || !existsSync(join(releaseDir, "rules", "rulesets.json"))) {
  console.error("Usage: node scripts/update-live-ads.mjs <unzipped release dir>");
  process.exit(1);
}

const release = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8")).version;
const baseline = new Set();
for (const entry of JSON.parse(readFileSync(join(releaseDir, "rules", "rulesets.json"), "utf8"))) {
  if (!BASELINE_GROUPS.has(entry.group)) continue;
  const rules = JSON.parse(readFileSync(join(releaseDir, "rules", entry.file), "utf8"));
  for (const domain of plainBlockedDomains(rules, { allowResourceTypes: true, allowThirdParty: true })) baseline.add(domain);
}
if (baseline.size < OISD_MIN_DOMAINS) {
  console.error(`Release ${release} blocks only ${baseline.size} domains in ${[...BASELINE_GROUPS].join("/")}; refusing to diff against it.`);
  process.exit(1);
}

const response = await fetchWithRetry(OISD_URL);
const today = parseOisdList(await response.text());
if (today.length < OISD_MIN_DOMAINS) {
  console.error(`oisd parsed to only ${today.length} domains; its format may have changed.`);
  process.exit(1);
}

const psl = await loadPsl();
const fresh = cleanSecurityDomains(today.filter((domain) => !isBlockedByDomainChain(domain, baseline)))
  .filter((domain) => registrableDomain(domain, psl) !== null);
const { kept, dropped: popularDropped } = dropPopularSites(fresh, await loadPopularSites(psl));
const domains = kept.slice(0, MAX_LIVE_AD_DOMAINS);

const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { domains: [] };
let review = adChangeNeedsReview(previous.domains ?? [], domains);
if (!review && popularDropped.length > 5) review = `${popularDropped.length} popular sites listed`;
console.log(`oisd today: ${today.length}; release ${release} already blocks ${today.length - fresh.length}; new: ${domains.length}`);
if (popularDropped.length > 0) console.log(`  popular sites left out: ${popularDropped.join(", ")}`);

if (previous.release === release && JSON.stringify(previous.domains) === JSON.stringify(domains)) {
  console.log("No change since the published list.");
  process.exit(0);
}
writeFileSync(outPath, JSON.stringify({ format: LIVE_ADS_FORMAT, generated: new Date().toISOString(), release, domains }));
console.log("Wrote live/ad-domains.json");
if (review) {
  console.log(`Needs review before publishing: ${review}`);
  process.exit(3);
}

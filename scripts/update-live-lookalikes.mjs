// Writes live/lookalike-domains.json: domains registered in the last week
// whose names imitate a brand, bank or sign-in page (scripts/lib/lookalikes.mjs),
// kept for 30 days. The source is HaGeZi's newly-registered-domain list
// (GPL-3.0, https://github.com/hagezi/nrd). The extension shows a warning
// page with "Open anyway" for them (src/background/liveLookalikeRules.ts).
// Run by .github/workflows/security-live.yml once a day:
//   node scripts/update-live-lookalikes.mjs
//
// Same guardrails as the other daily lists: well-formed hosts only, no IP
// address, public suffix, protected site or shared link host
// (src/shared/liveSecurity.ts), none of the Tranco top 10,000, and a day
// adding too many goes to a person (src/shared/liveLookalikes.ts).
//
// Exit codes: 0 = written (or unchanged), 3 = written but needs review,
// 1 = failed (nothing written).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { domainToUnicode, fileURLToPath } from "node:url";
import { fetchWithRetry } from "./lib/fetchWithRetry.mjs";
import { lookalikeBrand } from "./lib/lookalikes.mjs";
import { loadPopularSites, dropPopularSites } from "./lib/popularSites.mjs";
import { loadPsl, registrableDomain } from "./lib/publicSuffixList.mjs";
import { cleanSecurityDomains } from "../src/shared/liveSecurity.ts";
import { LIVE_LOOKALIKES_FORMAT, LOOKALIKE_DAYS, MAX_LOOKALIKES, lookalikeChangeNeedsReview } from "../src/shared/liveLookalikes.ts";

const NRD_URL = "https://raw.githubusercontent.com/hagezi/nrd/main/domains/nrd7.txt";
/** A normal week is over 2 million; far fewer means the format changed. */
const NRD_MIN_DOMAINS = 100_000;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "live", "lookalike-domains.json");
const today = new Date().toISOString().slice(0, 10);
const oldest = new Date(Date.now() - LOOKALIKE_DAYS * 86_400_000).toISOString().slice(0, 10);

const psl = await loadPsl();
/** The brand a registrable domain imitates, or null. */
function brandOf(domain) {
  const registrable = registrableDomain(domain, psl);
  if (!registrable) return null;
  const suffix = registrable.slice(registrable.indexOf(".") + 1);
  return lookalikeBrand(domainToUnicode(domain.slice(0, domain.length - suffix.length - 1)), registrable);
}

const nrd = (await (await fetchWithRetry(NRD_URL)).text()).split("\n").map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith("#"));
if (nrd.length < NRD_MIN_DOMAINS) {
  console.error(`The new-domain list parsed to only ${nrd.length} domains; its format may have changed.`);
  process.exit(1);
}

// Earlier days' sites stay for LOOKALIKE_DAYS, checked again so a matcher
// fix takes back its mistakes.
const first = !existsSync(outPath);
const previous = !first ? JSON.parse(readFileSync(outPath, "utf8")) : { domains: {} };
const found = new Map();
for (const [domain, entry] of Object.entries(previous.domains ?? {})) {
  const brand = brandOf(domain);
  if (brand && entry.added >= oldest) found.set(domain, { brand, added: entry.added });
}
for (const name of nrd) {
  const domain = registrableDomain(name, psl);
  if (!domain || found.has(domain)) continue;
  const brand = brandOf(name);
  if (brand) found.set(domain, { brand, added: today });
}

const clean = cleanSecurityDomains([...found.keys()]);
const { kept, dropped: popularDropped } = dropPopularSites(clean, await loadPopularSites(psl));
// Newest first, so the cap drops the oldest.
kept.sort((a, b) => found.get(b).added.localeCompare(found.get(a).added) || a.localeCompare(b));
const domains = Object.fromEntries(kept.slice(0, MAX_LOOKALIKES).sort().map((domain) => [domain, found.get(domain)]));

// The first list goes to a person too: it starts showing warning pages.
let review = first ? "first lookalike list" : lookalikeChangeNeedsReview(Object.keys(previous.domains ?? {}), Object.keys(domains));
if (!review && popularDropped.length > 5) review = `${popularDropped.length} popular sites matched`;
console.log(`new domains this week: ${nrd.length}; lookalikes listed: ${Object.keys(domains).length}`);
if (popularDropped.length > 0) console.log(`  popular sites left out: ${popularDropped.join(", ")}`);

if (JSON.stringify(previous.domains) === JSON.stringify(domains)) {
  console.log("No change since the published list.");
  process.exit(0);
}
writeFileSync(outPath, JSON.stringify({ format: LIVE_LOOKALIKES_FORMAT, generated: new Date().toISOString(), domains }));
console.log("Wrote live/lookalike-domains.json");
if (review) {
  console.log(`Needs review before publishing: ${review}`);
  process.exit(3);
}

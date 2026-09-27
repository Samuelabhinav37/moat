// Writes live/security-domains.json: today's phishing, malicious-URL and
// scam domain lists (sources in src/shared/liveSecurity.ts), for the
// extension to apply daily on top of the bundled copies. Run by
// .github/workflows/security-live.yml once a day.
//
// Guardrails (see liveSecurity.ts): only well-formed host names, never an
// IP address, a public suffix (blocking "github.io" would take down every
// site on it) or a protected site; and a day's change that's too big to
// trust unattended is flagged for review instead of published.
//
// Exit codes: 0 = written (or unchanged), 3 = written but needs a person
// to review it (the workflow opens a pull request instead of publishing),
// 1 = failed (nothing written; the published file stays as it is).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./lib/fetchWithRetry.mjs";
import { loadPsl, registrableDomain } from "./lib/publicSuffixList.mjs";
import {
  LIVE_SECURITY_FORMAT,
  LIVE_SECURITY_GROUPS,
  LIVE_SECURITY_SOURCES,
  cleanSecurityDomains,
  parseDomainList,
  securityChangeNeedsReview,
} from "../src/shared/liveSecurity.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "live", "security-domains.json");

const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { groups: {} };
const psl = await loadPsl();

const groups = {};
const reviews = [];
for (const group of LIVE_SECURITY_GROUPS) {
  const response = await fetchWithRetry(LIVE_SECURITY_SOURCES[group]);
  const cleaned = cleanSecurityDomains(parseDomainList(await response.text()));
  const domains = cleaned.filter((domain) => registrableDomain(domain, psl) !== null);
  const dropped = cleaned.length - domains.length;
  const review = securityChangeNeedsReview(previous.groups?.[group] ?? [], domains);
  if (review) reviews.push(`${group}: ${review}`);
  groups[group] = domains;
  console.log(`${group}: ${domains.length} domains${dropped ? ` (${dropped} public suffixes dropped)` : ""}${review ? ` -- NEEDS REVIEW: ${review}` : ""}`);
}

const unchanged = LIVE_SECURITY_GROUPS.every(
  (group) => JSON.stringify(previous.groups?.[group] ?? []) === JSON.stringify(groups[group])
);
if (unchanged) {
  console.log("No change since the published lists.");
  process.exit(0);
}
writeFileSync(outPath, JSON.stringify({ format: LIVE_SECURITY_FORMAT, generated: new Date().toISOString(), groups }));
console.log(`Wrote live/security-domains.json`);
if (reviews.length > 0) {
  console.log(`Needs review before publishing:\n  ${reviews.join("\n  ")}`);
  process.exit(3);
}

#!/usr/bin/env node
// Throwaway research script -- not run by any npm script, CI job, or build
// step, and does not write to rules/dnr/ or any other build output. Turns
// consolidation-audit.mjs's Finding 2 (risky sibling-subdomain
// consolidation candidates) into a reviewable shortlist by cross-referencing
// each candidate's registrable domain against Ghostery's TrackerDB -- the
// same vendored data update-filters.mjs already uses for company
// attribution. A candidate only gets listed here if TrackerDB confirms it
// resolves to a single known company; anything TrackerDB doesn't recognize
// is counted but never named, since "no confirmation" is not the same as
// "safe."
//
// This produces a document for a HUMAN to review and decide on, one group
// at a time -- it never writes a consolidated rule itself. See
// docs/research/dnr-rule-consolidation-audit.md's Finding 2 for why: turning
// N sibling-subdomain block rules into one apex rule broadens blocking scope
// to every other current or future subdomain of that domain, which is a
// real behavior change no amount of sibling-count alone can justify safely.
// A trackerdb match raises confidence (a known company plausibly does own
// that whole domain) but is still not proof, hence "reviewed", not "auto-
// applied".
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPsl, registrableDomain } from "../lib/publicSuffixList.mjs";
import { lookupCompany } from "../lib/ruleCompany.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES_DIR = join(ROOT, "rules", "dnr");
const TRACKERDB_PATH = join(ROOT, "node_modules", "@ghostery", "trackerdb", "dist", "trackerdb.json");
const OUT_DOC = join(ROOT, "docs", "research", "consolidation-candidates-reviewed.md");

const SIBLING_THRESHOLD = 5;
const SIMPLE_BLOCK = /^\|\|([a-z0-9.-]+)\^$/;

function resourceTypesKey(condition) {
  return [...(condition.resourceTypes ?? [])].sort().join(",");
}

function isSimpleDomainBlock(rule) {
  if (rule.action?.type !== "block") return false;
  const condition = rule.condition ?? {};
  const extraKeys = Object.keys(condition).filter((k) => k !== "urlFilter" && k !== "resourceTypes");
  if (extraKeys.length > 0) return false;
  return SIMPLE_BLOCK.test(condition.urlFilter ?? "");
}

/** Same grouping as consolidation-audit.mjs's Finding 2 -- non-redundant
 * simple domain-block rules, grouped by real registrable domain, apex-rule
 * groups excluded (those aren't a "sibling consolidation" case at all). */
function findCandidateGroups(rules, psl) {
  const simple = [];
  for (const rule of rules) {
    if (!isSimpleDomainBlock(rule)) continue;
    const domain = SIMPLE_BLOCK.exec(rule.condition.urlFilter)[1];
    simple.push({ domain, key: resourceTypesKey(rule.condition) });
  }
  const domainsByKey = new Map();
  for (const entry of simple) {
    if (!domainsByKey.has(entry.key)) domainsByKey.set(entry.key, new Set());
    domainsByKey.get(entry.key).add(entry.domain);
  }
  const nonRedundant = simple.filter((entry) => {
    const domains = domainsByKey.get(entry.key);
    const labels = entry.domain.split(".");
    return !labels.slice(1).some((_, i) => domains.has(labels.slice(i + 1).join(".")));
  });

  const apexDomains = new Set(nonRedundant.map((e) => e.domain));
  const groups = new Map();
  for (const entry of nonRedundant) {
    const reg = registrableDomain(entry.domain, psl);
    if (reg === null || reg === entry.domain || apexDomains.has(reg)) continue;
    const groupKey = `${reg}|${entry.key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { registrable: reg, siblingCount: 0 });
    groups.get(groupKey).siblingCount += 1;
  }
  return [...groups.values()].filter((g) => g.siblingCount >= SIBLING_THRESHOLD);
}

async function main() {
  if (!existsSync(TRACKERDB_PATH)) {
    console.error(`TrackerDB not found at ${TRACKERDB_PATH} -- run "npm install" first.`);
    process.exitCode = 1;
    return;
  }
  const trackerDb = JSON.parse(readFileSync(TRACKERDB_PATH, "utf8"));

  console.log("Fetching Public Suffix List from publicsuffix.org ...");
  const psl = await loadPsl();

  const manifest = JSON.parse(readFileSync(join(RULES_DIR, "manifest.json"), "utf8"));
  const eligible = manifest.filter((entry) => entry.category !== "security");

  // Merge same-registrable-domain groups across every file/chunk -- a
  // domain's sibling rules can land in different chunk files (ruleset_ads-1
  // vs ruleset_ads-2) purely due to chunkBySize's size-based splitting, and
  // that split shouldn't hide a real consolidation candidate or double-list
  // one that happens to appear in two chunks.
  const merged = new Map();
  for (const entry of eligible) {
    const rules = JSON.parse(readFileSync(join(RULES_DIR, entry.file), "utf8"));
    for (const group of findCandidateGroups(rules, psl)) {
      const existing = merged.get(group.registrable);
      if (existing) existing.siblingCount += group.siblingCount;
      else merged.set(group.registrable, { registrable: group.registrable, siblingCount: group.siblingCount });
    }
  }

  const confirmed = [];
  let unconfirmedCount = 0;
  for (const group of merged.values()) {
    if (group.siblingCount < SIBLING_THRESHOLD) continue; // re-check after merging across chunks
    const company = lookupCompany(group.registrable, trackerDb);
    if (company) confirmed.push({ ...group, company });
    else unconfirmedCount += 1;
  }
  confirmed.sort((a, b) => b.siblingCount - a.siblingCount);

  console.log(`${confirmed.length} candidate group(s) confirmed against TrackerDB, ${unconfirmedCount} unconfirmed (not listed).`);

  const lines = [
    "# Consolidation candidates confirmed against TrackerDB (for human review)",
    "",
    "Generated by `scripts/analysis/consolidation-candidates-reviewed.mjs` -- re-run it for a",
    "current list; the exact groups and counts drift with every `@adguard/dnr-rulesets` update.",
    "**Nothing on this list has been consolidated.** Each row is a registrable domain where",
    "several individual subdomains are each blocked separately, no rule blocks the apex domain",
    "itself, and TrackerDB independently confirms the domain belongs to one known company --",
    "raising confidence that consolidating to a single `||domain^` rule is safe, but not proving",
    "it. See `docs/research/dnr-rule-consolidation-audit.md`'s Finding 2 for the full reasoning",
    "and why this stays a manual, reviewed decision per domain rather than an automatic build step.",
    "",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    `Confirmed: ${confirmed.length} group(s). Unconfirmed (TrackerDB has no match -- not listed, not safe to assume): ${unconfirmedCount} group(s).`,
    "",
    "| Registrable domain | Company (via TrackerDB) | Sibling subdomain rules |",
    "|---|---|---|",
    ...confirmed.map((g) => `| \`${g.registrable}\` | ${g.company} | ${g.siblingCount} |`),
    "",
  ];
  writeFileSync(OUT_DOC, lines.join("\n"));
  console.log(`Wrote ${OUT_DOC}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

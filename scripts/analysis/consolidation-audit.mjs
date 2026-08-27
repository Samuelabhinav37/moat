#!/usr/bin/env node
// Throwaway research script -- not run by any npm script, CI job, or build
// step. Investigates whether Moat's bundled ad/tracker DNR rulesets contain
// same-registrable-domain "block" rules that could be consolidated into
// fewer rules, and measures the real risk of doing so. Produces the numbers
// behind docs/research/dnr-rule-consolidation-audit.md -- re-run it
// (`node scripts/analysis/consolidation-audit.mjs`) any time the bundled
// rulesets change to get fresh numbers; nothing here is wired into the
// extension build.
//
// Two categorically different findings, kept separate on purpose:
//
//   (a) SAFE, zero-risk redundancy: a rule blocking "sub.example.com" is
//       already fully covered by another rule in the SAME ruleset blocking
//       an ancestor domain (e.g. "example.com") with an equal-or-broader
//       resourceTypes set -- declarativeNetRequest's own "||" domain anchor
//       already matches every subdomain, so the child rule blocks nothing
//       the parent doesn't already block. Removing it is a pure rule-count
//       win with NO behavior change. This needs no domain-ownership
//       knowledge at all -- it's a literal fact about the two rules.
//
//   (b) RISKY, requires-review consolidation: N sibling subdomains of the
//       same *registrable* domain are each blocked individually, but no
//       rule blocks the registrable domain itself. Replacing them with one
//       "||registrable-domain^" rule is NOT a pure optimization -- it
//       extends blocking to every OTHER current or future subdomain of that
//       registrable domain, including ones nobody has verified belong to
//       the same tracker. This is exactly the shared-hosting trap
//       scripts/update-filters.mjs's own company-attribution code already
//       had to guard against (see its "chain-walking those up to the
//       platform's own registrable domain would misattribute the block"
//       comment) -- a handful of subdomains on github.io/blogspot.com/etc.
//       being blocked does NOT mean the whole platform should be.
//
// Getting the registrable domain right for (b) is the whole reason this
// fetches the REAL Public Suffix List instead of a naive "last two labels"
// split: a naive split both (1) treats multi-label ccTLD suffixes like
// co.uk/com.br/com.au/co.jp as if they were themselves registrable domains,
// grouping every unrelated *.co.uk site as "siblings", and (2) has no way to
// know that github.io/blogspot.com/weebly.com etc. are shared-hosting
// platforms, not single owners -- the real PSL already lists these in its
// "private" section for exactly this reason, so a correct PSL lookup
// naturally refuses to group their subdomains as siblings at all.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPsl, registrableDomain } from "../lib/publicSuffixList.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "..", "..", "rules", "dnr");

// Rules in this many or more distinct registrable-domain siblings are
// reported as a (b)-style consolidation candidate. Below this, the
// per-review cost of manually confirming shared ownership isn't worth a
// 2-3 rule saving.
const SIBLING_THRESHOLD = 5;

const SIMPLE_BLOCK = /^\|\|([a-z0-9.-]+)\^$/;

function resourceTypesKey(condition) {
  return [...(condition.resourceTypes ?? [])].sort().join(",");
}

/** Only rules whose entire condition is "block this exact domain (+
 * subdomains) for these resource types" qualify -- anything with
 * initiatorDomains/excludedInitiatorDomains/domainType/etc. has extra
 * semantics a naive domain-based merge would silently drop. */
function isSimpleDomainBlock(rule) {
  if (rule.action?.type !== "block") return false;
  const condition = rule.condition ?? {};
  const extraKeys = Object.keys(condition).filter((k) => k !== "urlFilter" && k !== "resourceTypes");
  if (extraKeys.length > 0) return false;
  return SIMPLE_BLOCK.test(condition.urlFilter ?? "");
}

function isAncestor(candidateAncestor, domain) {
  return domain === candidateAncestor || domain.endsWith("." + candidateAncestor);
}

function auditRuleset(file, rules, psl) {
  const simple = [];
  for (const rule of rules) {
    if (!isSimpleDomainBlock(rule)) continue;
    const domain = SIMPLE_BLOCK.exec(rule.condition.urlFilter)[1];
    simple.push({ id: rule.id, domain, key: resourceTypesKey(rule.condition) });
  }

  // (a) exact, zero-risk redundancy: another rule in this SAME file already
  // blocks an ancestor domain with an equal-or-broader resourceTypes set.
  const byKey = new Map(); // resourceTypesKey -> Set<domain>, for ancestor lookups scoped to matching conditions
  for (const entry of simple) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, new Set());
    byKey.get(entry.key).add(entry.domain);
  }
  const redundant = [];
  const nonRedundant = [];
  for (const entry of simple) {
    const domains = byKey.get(entry.key);
    const labels = entry.domain.split(".");
    let coveredBy = null;
    for (let i = 1; i < labels.length; i++) {
      const ancestor = labels.slice(i).join(".");
      if (domains.has(ancestor)) {
        coveredBy = ancestor;
        break;
      }
    }
    if (coveredBy) redundant.push({ ...entry, coveredBy });
    else nonRedundant.push(entry);
  }

  // (b) risky consolidation candidates: group the non-redundant leftovers by
  // real registrable domain, only where the registrable domain itself isn't
  // already one of the existing rules (that case is already (a)-redundant).
  const apexDomains = new Set(nonRedundant.map((e) => e.domain));
  const groups = new Map(); // "registrableDomain|key" -> entries[]
  const excludedAsSuffix = new Set();
  for (const entry of nonRedundant) {
    const reg = registrableDomain(entry.domain, psl);
    if (reg === null) {
      excludedAsSuffix.add(entry.domain);
      continue;
    }
    if (reg === entry.domain) continue; // this IS the apex rule already
    if (apexDomains.has(reg)) continue; // apex already covered as its own non-redundant entry, not (a) because key may differ -- still not a gap
    const groupKey = `${reg}|${entry.key}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { registrable: reg, key: entry.key, entries: [] });
    groups.get(groupKey).entries.push(entry);
  }
  const candidates = [...groups.values()]
    .filter((g) => g.entries.length >= SIBLING_THRESHOLD)
    .sort((a, b) => b.entries.length - a.entries.length);

  return {
    file,
    total: rules.length,
    simpleBlockCount: simple.length,
    redundantCount: redundant.length,
    excludedAsSuffixCount: excludedAsSuffix.size,
    excludedAsSuffixSample: [...excludedAsSuffix].slice(0, 10),
    candidates,
  };
}

async function main() {
  console.log(`Fetching Public Suffix List from publicsuffix.org ...`);
  const psl = await loadPsl();
  console.log(`Loaded ${psl.rules.size} suffix rules, ${psl.exceptions.size} exceptions.`);

  const manifest = JSON.parse(readFileSync(join(RULES_DIR, "manifest.json"), "utf8"));
  // Security rulesets are deliberately excluded -- see the file header. Only
  // ads/trackers/url-tracking/popups/annoyance-category rulesets (Moat's
  // "category" field, not "group") are eligible.
  const eligible = manifest.filter((entry) => entry.category !== "security");

  const results = [];
  for (const entry of eligible) {
    const rules = JSON.parse(readFileSync(join(RULES_DIR, entry.file), "utf8"));
    const result = auditRuleset(entry.file, rules, psl);
    result.group = entry.group;
    results.push(result);
  }

  let totalRules = 0;
  let totalSimple = 0;
  let totalRedundant = 0;
  let totalCandidateEntries = 0;
  let totalCandidateGroups = 0;
  const allCandidates = [];
  for (const r of results) {
    totalRules += r.total;
    totalSimple += r.simpleBlockCount;
    totalRedundant += r.redundantCount;
    totalCandidateGroups += r.candidates.length;
    for (const c of r.candidates) {
      totalCandidateEntries += c.entries.length;
      allCandidates.push({ file: r.file, group: r.group, registrable: c.registrable, siblingCount: c.entries.length });
    }
    console.log(
      `${r.file} (${r.group}): ${r.total} rules, ${r.simpleBlockCount} simple domain-blocks, ` +
        `${r.redundantCount} already-redundant, ${r.candidates.length} consolidation-candidate groups ` +
        `(excluded ${r.excludedAsSuffixCount} domains as PSL suffixes themselves, e.g. ${r.excludedAsSuffixSample.slice(0, 3).join(", ") || "none"})`
    );
  }

  allCandidates.sort((a, b) => b.siblingCount - a.siblingCount);

  console.log("\n=== Summary across all eligible rulesets ===");
  console.log(`Total rules scanned: ${totalRules}`);
  console.log(`Simple domain-block rules: ${totalSimple} (${((totalSimple / totalRules) * 100).toFixed(1)}%)`);
  console.log(
    `(a) Already redundant (safe to drop, zero behavior change): ${totalRedundant} ` +
      `(${((totalRedundant / totalSimple) * 100).toFixed(2)}% of simple domain-blocks)`
  );
  console.log(
    `(b) Risky consolidation candidate groups (>= ${SIBLING_THRESHOLD} siblings, needs manual review): ` +
      `${totalCandidateGroups} groups covering ${totalCandidateEntries} rules -- would collapse to ${totalCandidateGroups} ` +
      `rules IF every one were verified safe, a rule-count reduction of ${totalCandidateEntries - totalCandidateGroups}`
  );
  console.log("\nTop 15 (b) candidate groups by sibling count:");
  for (const c of allCandidates.slice(0, 15)) {
    console.log(`  ${c.registrable} (${c.group}/${c.file}): ${c.siblingCount} sibling subdomain rules`);
  }

  const outPath = join(__dirname, "consolidation-audit-results.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), siblingThreshold: SIBLING_THRESHOLD, totalRules, totalSimple, totalRedundant, totalCandidateGroups, totalCandidateEntries, perRuleset: results, topCandidates: allCandidates.slice(0, 50) },
      null,
      2
    )
  );
  console.log(`\nFull results written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

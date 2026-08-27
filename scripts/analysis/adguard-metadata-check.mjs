#!/usr/bin/env node
// Throwaway research script -- not run by any npm script, CI job, or build
// step. Part 3 of the lightweight-architecture follow-up: checks whether
// @adguard/dnr-rulesets' own package metadata exposes anything usable for
// identifying "dead" rules (rules that never match real traffic -- Snyder et
// al.'s "Who Filters the Filters" found ~90% of EasyList rules provide no
// benefit against real traffic, but published no dataset to cross-reference
// against; see docs/research/dead-rule-pruning-feasibility.md), and measures
// how far behind Moat's pinned version actually is right now. Re-run it
// (`node scripts/analysis/adguard-metadata-check.mjs`) any time you want a
// fresh reading; needs network access (npm registry + node_modules already
// installed).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const PACKAGE_NAME = "@adguard/dnr-rulesets";

function readInstalledVersion() {
  const pkgPath = join(ROOT, "node_modules", "@adguard", "dnr-rulesets", "package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

async function checkUpdateCadence(installed) {
  console.log(`Installed (locked) version: ${installed}`);
  const registry = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}`).then((r) => r.json());
  const versions = Object.keys(registry.versions);
  // Same major-version line only -- comparing across major lines (this
  // package publishes several in parallel, e.g. 3.3.x/4.0.x/4.1.x/4.2.x/5.0.x
  // at once) would overstate the gap with releases Moat was never on anyway.
  const major = installed.split(".")[0];
  const sameMajor = versions.filter((v) => v.startsWith(`${major}.`));
  const installedIdx = sameMajor.indexOf(installed);
  const latest = sameMajor[sameMajor.length - 1];
  const behindCount = installedIdx === -1 ? null : sameMajor.length - 1 - installedIdx;
  const installedTime = registry.time[installed];
  const latestTime = registry.time[latest];

  console.log(`Latest ${major}.x version: ${latest}`);
  if (behindCount !== null) {
    console.log(`Releases behind (same major line): ${behindCount}`);
  } else {
    console.log(`Installed version not found in registry's version list for major line ${major}.x (unexpected).`);
  }
  console.log(`Installed published: ${installedTime}`);
  console.log(`Latest published:    ${latestTime}`);
  if (installedTime && latestTime) {
    const gapHours = (new Date(latestTime) - new Date(installedTime)) / 3_600_000;
    console.log(`Time gap: ${gapHours.toFixed(1)} hours`);
  }
  return { installed, latest, behindCount };
}

/** Inspects one raw (pre-Moat-processing) ruleset file from node_modules for
 * whatever metadata AdGuard embeds, to check whether any of it looks like
 * usage/match telemetry (would help identify dead rules) vs. pure build
 * provenance (wouldn't). */
function inspectRawMetadata() {
  const candidate = join(
    ROOT,
    "node_modules",
    "@adguard",
    "dnr-rulesets",
    "dist",
    "filters",
    "chromium-mv3",
    "declarative",
    "ruleset_2",
    "ruleset_2.json"
  );
  if (!existsSync(candidate)) {
    console.log("\nRaw ruleset sample not found at the expected path (package layout may have changed) -- skipping.");
    return;
  }
  const rules = JSON.parse(readFileSync(candidate, "utf8"));
  const withMetadata = rules.find((r) => r.metadata);
  console.log(`\nInspected ${candidate}`);
  console.log(`${rules.length} rules; ${withMetadata ? "found" : "did not find"} an embedded "metadata" field.`);
  if (withMetadata) {
    const meta = withMetadata.metadata.metadata ?? withMetadata.metadata;
    const keys = Object.keys(meta);
    console.log(`Metadata keys present: ${keys.join(", ")}`);
    const usageLikeKeys = keys.filter((k) => /match|hit|usage|used|dead|prune|stale/i.test(k));
    console.log(
      usageLikeKeys.length > 0
        ? `Usage/telemetry-shaped keys found: ${usageLikeKeys.join(", ")} -- worth a closer look.`
        : "No usage/telemetry-shaped keys found (e.g. no matchCount/lastMatched/unusedSince) -- " +
            "this metadata is build provenance (source-file/line hashes, regex/unsafe rule counts), not " +
            "match statistics. It cannot answer 'which rules are dead' on its own."
    );
  }
}

/** Confirms Moat's own build (scripts/update-filters.mjs) already strips
 * this metadata before it ships -- so even if it DID carry something useful
 * one day, Moat would need to change its own pipeline to keep it, not just
 * upgrade the dependency. */
function checkMoatStripsMetadata() {
  const shipped = join(ROOT, "rules", "dnr", "ruleset_ads-1.json");
  if (!existsSync(shipped)) {
    console.log("\nrules/dnr/ruleset_ads-1.json not found -- run `npm run filters:update` first. Skipping this check.");
    return;
  }
  const rules = JSON.parse(readFileSync(shipped, "utf8"));
  const anyWithMetadata = rules.some((r) => r.metadata);
  console.log(
    `\nMoat's own shipped rules/dnr/ruleset_ads-1.json: ${
      anyWithMetadata ? "still carries" : "does NOT carry"
    } a "metadata" field on any rule (scripts/update-filters.mjs keeps only id/action/condition per rule).`
  );
}

async function main() {
  const installed = readInstalledVersion();
  await checkUpdateCadence(installed);
  inspectRawMetadata();
  checkMoatStripsMetadata();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

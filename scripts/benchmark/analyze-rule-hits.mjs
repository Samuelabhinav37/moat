// Summarizes .cache/crawl/hits.json (from crawl-rule-hits.mjs) against the
// original rulesets: per list, how many rules of each kind fired at least
// once on the crawled sites. Writes .cache/crawl/cold-rules.json (pattern
// block rules that never fired) for a what-if build.
//
//   node scripts/benchmark/analyze-rule-hits.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packableDomain } from "../lib/packDomainRules.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const crawl = JSON.parse(readFileSync(join(root, ".cache", "crawl", "hits.json"), "utf8"));
const unpacked = join(root, "rules", "dnr-unpacked");
const manifest = JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8"));
const presets = await import("../../src/shared/filterPresets.ts");
const balanced = presets.PRESETS.standard.filterGroups;

function kind(rule) {
  if (packableDomain(rule)) return "domain";
  const t = rule.action.type;
  if (t === "allow" || t === "allowAllRequests") return "exception";
  if (t === "redirect") return "redirect";
  if (t === "modifyHeaders") return "header";
  if (t === "block") return "pattern";
  return t;
}

const rows = [];
const cold = {};
const totals = {};
for (const entry of manifest) {
  const rules = JSON.parse(readFileSync(join(unpacked, entry.file), "utf8"));
  const stats = {};
  for (const rule of rules) {
    const k = kind(rule);
    stats[k] ??= { rules: 0, fired: 0 };
    stats[k].rules++;
    const hit = crawl.hits[`${entry.id}:${rule.id}`];
    if (hit) stats[k].fired++;
    else if (k === "pattern") (cold[entry.id] ??= []).push(rule.id);
    totals[k] ??= { rules: 0, fired: 0 };
    totals[k].rules++;
    if (hit) totals[k].fired++;
  }
  rows.push({ list: entry.id.replace("ruleset_", ""), balanced: balanced[entry.group] ?? true ? "yes" : "Strict", ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, `${v.fired}/${v.rules}`])) });
}
const ok = Object.values(crawl.status).filter((s) => typeof s === "number" && s < 400).length;
console.log(`Crawl: ${crawl.crawled} sites visited, ${ok} loaded; ${Object.keys(crawl.hits).length} distinct rules fired.\n`);
console.table(rows);
console.log("\nAll lists, fired / total:");
for (const [k, v] of Object.entries(totals)) console.log(`  ${k.padEnd(10)} ${v.fired.toLocaleString().padStart(7)} / ${v.rules.toLocaleString().padStart(7)}  (${((v.fired / v.rules) * 100).toFixed(1)}%)`);
writeFileSync(join(root, ".cache", "crawl", "cold-rules.json"), JSON.stringify(cold));
console.log(`\nPattern block rules that never fired: ${Object.values(cold).reduce((s, ids) => s + ids.length, 0).toLocaleString()} -> .cache/crawl/cold-rules.json`);

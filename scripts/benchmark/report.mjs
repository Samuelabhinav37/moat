// Scorecard from bench.mjs results: node scripts/benchmark/report.mjs
// Reads .cache/benchmark/bench-results[-tranco]-<blocker>.json (one file per
// blocker, as bench-all runs them) or the combined bench-results[-tranco].json,
// and writes .cache/benchmark/report.md + report.json.
//
// A site counts only if it loaded with no blocker (HTTP < 400, some text).
// "Possible breakage": with the blocker it failed to load, or kept under half
// the text it had with no blocker. Flags are leads, not verdicts: check the
// screenshots in .cache/benchmark/shots/<set>/<blocker>/<host>.jpg.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, ".cache", "benchmark");
const ORDER = ["none", "moat", "ubol", "adguard", "ghostery", "abp"];
const LABEL = { none: "No blocker", moat: "Moat", ubol: "uBlock Origin Lite", adguard: "AdGuard", ghostery: "Ghostery", abp: "Adblock Plus" };

function load(set) {
  const prefix = set === "ads" ? "bench-results" : `bench-results-${set}`;
  const out = {};
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(prefix) || !f.endsWith(".json")) continue;
    const rest = f.slice(prefix.length, -5);
    if (set === "ads" && rest.startsWith("-tranco")) continue;
    if (rest && !rest.slice(1).split("_").every((b) => ORDER.includes(b))) continue;
    Object.assign(out, JSON.parse(readFileSync(join(dir, f), "utf8")));
  }
  return out;
}

const median = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const ok = (s) => s && s.status > 0 && s.status < 400 && s.textLen > 100;

function score(set) {
  const r = load(set);
  if (!r.none) return null;
  const base = new Map(r.none.sites.map((s) => [s.url, s]));
  const rows = [];
  for (const name of ORDER) {
    if (!r[name]) continue;
    const sites = r[name].sites.filter((s) => ok(base.get(s.url)));
    const flags = [];
    for (const s of sites) {
      const b = base.get(s.url);
      if (!(s.status > 0 && s.status < 400)) flags.push({ url: s.url, why: `didn't load (${s.status})` });
      else if (s.textLen < b.textLen * 0.5) flags.push({ url: s.url, why: `text ${s.textLen} vs ${b.textLen}` });
    }
    const sum = (f) => sites.reduce((a, s) => a + (s[f] ?? 0), 0);
    rows.push({
      name, label: LABEL[name], sites: sites.length,
      trackersReached: sum("trackersReached"),
      sitesWithTrackers: sites.filter((s) => s.trackersReached > 0).length,
      adSlots: sum("adFrames") + sum("adBoxes"),
      flags,
      mb: +(sum("kb") / 1024).toFixed(1),
      lcp: median(sites.map((s) => s.lcp)),
      cls: median(sites.map((s) => s.cls)),
      clsMean: sites.length ? +(sum("cls") / sites.length).toFixed(4) : null,
      task: median(sites.map((s) => s.task)),
      battery: r[name].battery ? `${r[name].battery.blocked}/${r[name].battery.total}` : null,
      turnstile: r[name].turnstile,
      cnn: r[name].cnnBlocked15s,
      workerMB: r[name].workerHeapMB,
      startup: r[name].startup,
    });
  }
  const none = rows.find((x) => x.name === "none");
  for (const x of rows) x.trackerCut = none.trackersReached ? Math.round((1 - x.trackersReached / none.trackersReached) * 100) : null;
  return { set, rows };
}

const fmt = (v, d = 0) => (v == null ? "–" : typeof v === "number" ? v.toFixed(d) : v);
let md = `# Ad blocker benchmark\n\nGenerated ${new Date().toISOString()}. Every blocker at its own defaults in a fresh Chrome for Testing profile. Tracker = third-party request to a host DuckDuckGo blocks by default, not owned by the page's company.\n`;
const all = {};
for (const set of ["ads", "tranco"]) {
  const s = score(set);
  if (!s) continue;
  all[set] = s;
  const n = s.rows[0].sites;
  md += `\n## ${set === "ads" ? "Ad-heavy sites" : "Tranco sample"} (${n} sites)\n\n`;
  md += "| Blocker | Tracker requests reached | Fewer than none | Sites with a tracker | Ad slots seen | Possible breakage | MB | Median LCP ms | Median CLS | Mean CLS | Median main-thread s |\n|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const x of s.rows) md += `| ${x.label} | ${x.trackersReached} | ${x.name === "none" ? "–" : x.trackerCut + "%"} | ${x.sitesWithTrackers} | ${x.adSlots} | ${x.name === "none" ? "–" : x.flags.length} | ${x.mb} | ${fmt(x.lcp)} | ${fmt(x.cls, 4)} | ${fmt(x.clsMean, 4)} | ${fmt(x.task, 2)} |\n`;
  md += "\n| Blocker | d3ward hosts | Turnstile | cnn.com blocked in 15 s | Worker heap MB | Startup ms |\n|---|---|---|---|---|---|\n";
  for (const x of s.rows) md += `| ${x.label} | ${fmt(x.battery)} | ${fmt(x.turnstile)}/3 | ${fmt(x.cnn)} | ${fmt(x.workerMB)} | ${fmt(x.startup)} |\n`;
  for (const x of s.rows) if (x.flags.length) md += `\n${x.label} flags: ${x.flags.map((f) => `${new URL(f.url).hostname} (${f.why})`).join(", ")}\n`;
}
writeFileSync(join(dir, "report.md"), md);
writeFileSync(join(dir, "report.json"), JSON.stringify(all, null, 1));
console.log(md);
if (!existsSync(join(dir, "shots"))) console.log("(no screenshots found)");

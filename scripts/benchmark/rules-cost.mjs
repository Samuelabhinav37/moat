// What the rules cost Chrome, packed (dist/chrome) vs unpacked
// (rules/dnr-unpacked swapped in): time from launch until the Balanced
// rulesets are compiled and enabled, the size of Chrome's compiled rule
// index, the rules' share of the package, and how fast Chrome answers
// match lookups (testMatchOutcome, a stand-in for per-request cost).
//
//   npm run build:chrome && node scripts/benchmark/rules-cost.mjs [runs]
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { packDomainRules } from "../lib/packDomainRules.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "../chrome-for-testing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runs = Number(process.argv[2]) || 3;
const packedExt = join(root, "dist", "chrome");
const unpackedRules = join(root, "rules", "dnr-unpacked");
const work = mkdtempSync(join(tmpdir(), "moat-rulecost-"));
const unpackedExt = join(work, "ext");
cpSync(packedExt, unpackedExt, { recursive: true });
for (const entry of JSON.parse(readFileSync(join(unpackedRules, "manifest.json"), "utf8"))) {
  cpSync(join(unpackedRules, entry.file), join(unpackedExt, "rules", entry.file));
}
cpSync(join(unpackedRules, "manifest.json"), join(unpackedExt, "rules", "manifest.json"));

// Extra packed variants with other domains-per-rule sizes: PER_RULE=1000,50000
const variants = [];
for (const size of (process.env.PER_RULE ?? "").split(",").filter(Boolean).map(Number)) {
  const dir = join(work, `packed-${size}`);
  cpSync(packedExt, dir, { recursive: true });
  const companies = JSON.parse(readFileSync(join(root, "rules", "dnr", "rule-companies.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(unpackedRules, "manifest.json"), "utf8"));
  for (const entry of manifest) {
    const rules = JSON.parse(readFileSync(join(unpackedRules, entry.file), "utf8"));
    const keepIds = new Set(Object.keys(companies[entry.id] ?? {}).map(Number));
    const packed = packDomainRules(rules, { keepIds, perRule: size }).rules;
    entry.ruleCount = packed.length;
    writeFileSync(join(dir, "rules", entry.file), JSON.stringify(packed));
  }
  writeFileSync(join(dir, "rules", "manifest.json"), JSON.stringify(manifest));
  variants.push({ name: `packed ${size}/rule`, dir });
}

function dirSize(dir, filter = () => true) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir, { recursive: true })) {
    const path = join(dir, String(name));
    try {
      const st = statSync(path);
      if (st.isFile() && filter(String(name))) total += st.size;
    } catch {
      // A temp file Chrome removed while this was walking the folder.
    }
  }
  return total;
}

// A fixed set of lookups: every 20th domain from the original rules, plus
// clean sites, so both builds answer the same questions.
const domains = [];
for (const entry of JSON.parse(readFileSync(join(unpackedRules, "manifest.json"), "utf8"))) {
  for (const rule of JSON.parse(readFileSync(join(unpackedRules, entry.file), "utf8"))) {
    const m = /^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)+)\^/.exec(rule.condition?.urlFilter ?? "");
    if (m && !/^[\d.]+$/.test(m[1])) domains.push(m[1]);
  }
}
const lookups = [];
for (let i = 0; i < domains.length && lookups.length < 50000; i += 5) {
  lookups.push({ url: `https://${domains[i]}/a.js`, type: "script", initiator: "https://news.example" });
  lookups.push({ url: `https://cdn${i}.clean-site.example/app.js`, type: "script", initiator: "https://news.example" });
}

async function measure(extDir) {
  const profile = mkdtempSync(join(tmpdir(), "moat-rulecost-profile-"));
  const launched = Date.now();
  const browser = await puppeteer.launch({ executablePath: await chromePath(root), headless: true, pipe: true, userDataDir: profile, enableExtensions: [extDir],
    // GitHub's Linux runners can't use Chrome's sandbox (same as check-chrome-load.mjs).
    args: process.env.CI ? ["--no-sandbox"] : [] });
  try {
    const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"), { timeout: 60000 });
    const workerAt = Date.now() - launched;
    const worker = await target.worker();
    // Balanced leaves these three off; ready = everything else is on.
    const off = new Set(["ruleset_cookie-notices", "ruleset_social-widgets", "ruleset_annoyances"]);
    let readyAt = null;
    for (let i = 0; i < 400 && readyAt === null; i++) {
      const state = await worker.evaluate(async () => {
        const all = chrome.runtime.getManifest().declarative_net_request.rule_resources.map((r) => r.id);
        const on = await chrome.declarativeNetRequest.getEnabledRulesets();
        return { all, on };
      });
      const want = state.all.filter((id) => !off.has(id));
      if (want.every((id) => state.on.includes(id))) readyAt = Date.now() - launched;
      else await new Promise((r) => setTimeout(r, 50));
    }
    // Best of three passes: the lookups go through an extension API call
    // each, so single passes are noisy.
    let lookupMs = Infinity;
    for (let pass = 0; pass < 3; pass++) {
      const t0 = Date.now();
      await worker.evaluate(async (lookups) => {
        for (let i = 0; i < lookups.length; i += 2000) {
          await Promise.all(lookups.slice(i, i + 2000).map((l) => chrome.declarativeNetRequest.testMatchOutcome(l)));
        }
      }, lookups);
      lookupMs = Math.min(lookupMs, Date.now() - t0);
    }
    await browser.close();
    const indexBytes = dirSize(join(extDir, "_metadata")) + dirSize(profile, (n) => /indexed|Extension Rules/i.test(n));
    return { workerAt, readyAt, lookupMs, indexBytes };
  } finally {
    await browser.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
    rmSync(join(extDir, "_metadata"), { recursive: true, force: true });
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// A what-if: the packed build minus pattern block rules that never fired in
// a crawl (TRIM=.cache/crawl/cold-rules.json), security lists excluded.
if (process.env.TRIM) {
  const cold = JSON.parse(readFileSync(process.env.TRIM, "utf8"));
  const dir = join(work, "trimmed");
  cpSync(packedExt, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(packedExt, "rules", "manifest.json"), "utf8"));
  let removed = 0;
  for (const entry of manifest) {
    if (entry.category === "security" || !cold[entry.id]) continue;
    const drop = new Set(cold[entry.id]);
    const rules = JSON.parse(readFileSync(join(packedExt, "rules", entry.file), "utf8")).filter((r) => !drop.has(r.id));
    removed += entry.ruleCount - rules.length;
    entry.ruleCount = rules.length;
    writeFileSync(join(dir, "rules", entry.file), JSON.stringify(rules));
  }
  writeFileSync(join(dir, "rules", "manifest.json"), JSON.stringify(manifest));
  console.log(`trimmed variant: ${removed.toLocaleString()} never-fired non-security pattern rules removed`);
  variants.push({ name: "packed + trimmed", dir });
}
const builds = [{ name: "unpacked", dir: unpackedExt }, { name: "packed", dir: packedExt }, ...variants];
const results = Object.fromEntries(builds.map((b) => [b.name, []]));
for (let i = 0; i < runs; i++) {
  for (const b of builds) results[b.name].push(await measure(b.dir));
}
const rulesBytes = (dir) => dirSize(join(dir, "rules"), (n) => /^ruleset_.*\.json$/.test(n));
const count = (dir) => JSON.parse(readFileSync(join(dir, "rules", "manifest.json"), "utf8")).reduce((s, e) => s + e.ruleCount, 0);
const row = (name, dir, rs) => ({
  build: name,
  rules: count(dir),
  "ruleset files": `${(rulesBytes(dir) / 1048576).toFixed(1)} MB`,
  "worker up (ms)": median(rs.map((r) => r.workerAt)),
  "rules ready (ms)": median(rs.map((r) => r.readyAt ?? NaN)),
  "compiled index": `${(median(rs.map((r) => r.indexBytes)) / 1048576).toFixed(1)} MB`,
  [`${lookups.length.toLocaleString()} lookups (ms)`]: median(rs.map((r) => r.lookupMs)),
});
console.table(builds.map((b) => row(b.name, b.dir, results[b.name])));
rmSync(work, { recursive: true, force: true });

// Which rules actually fire on popular sites. Loads Moat with the original
// (unpacked) rulesets, every ruleset on, and counts every rule match Chrome
// reports (declarativeNetRequest.onRuleMatchedDebug, available to an
// unpacked extension) while visiting each site's homepage. Evidence for
// deciding which pattern rules earn their place; nothing is sent anywhere.
//
//   npm run build:chrome && node scripts/benchmark/crawl-rule-hits.mjs <sites.csv> [tabs]
//
// sites.csv: Tranco format ("rank,domain"). Writes .cache/crawl/hits.json.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "../chrome-for-testing.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sites = readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/).map((line) => line.split(",")[1]).filter(Boolean);
const tabs = Number(process.argv[3]) || 4;
const outDir = join(root, ".cache", "crawl");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ext = join(mkdtempSync(join(tmpdir(), "moat-crawl-")), "ext");
cpSync(join(root, "dist", "chrome"), ext, { recursive: true });
const unpacked = join(root, "rules", "dnr-unpacked");
for (const e of JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8"))) cpSync(join(unpacked, e.file), join(ext, "rules", e.file));
cpSync(join(unpacked, "manifest.json"), join(ext, "rules", "manifest.json"));

const browser = await puppeteer.launch({
  executablePath: await chromePath(root),
  headless: true,
  pipe: true,
  userDataDir: mkdtempSync(join(tmpdir(), "moat-crawl-profile-")),
  enableExtensions: [ext],
  args: ["--mute-audio", ...(process.env.CI ? ["--no-sandbox"] : [])],
});
const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"), { timeout: 60000 });
const worker = await target.worker();
await sleep(6000);
await worker.evaluate(async () => {
  const ids = chrome.runtime.getManifest().declarative_net_request.rule_resources.map((r) => r.id);
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ids });
  globalThis.__hits = new Map();
  globalThis.__hitSites = new Map();
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const key = `${info.rule.rulesetId}:${info.rule.ruleId}`;
    globalThis.__hits.set(key, (globalThis.__hits.get(key) ?? 0) + 1);
    let host = "";
    try {
      host = new URL(info.request.initiator ?? info.request.url).hostname;
    } catch {}
    const set = globalThis.__hitSites.get(key) ?? new Set();
    if (set.size < 50) set.add(host);
    globalThis.__hitSites.set(key, set);
  });
});
const ua = (await browser.userAgent()).replace("HeadlessChrome", "Chrome");

const status = {};
let next = 0;
let done = 0;
const started = Date.now();
async function lane() {
  const page = await browser.newPage();
  await page.setUserAgent(ua);
  await page.setViewport({ width: 1280, height: 900 });
  // A site can hold the page up (an alert, a script that never yields); none
  // of that may stall the crawl.
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  const within = (ms, work) => Promise.race([work, sleep(ms).then(() => "timeout")]);
  while (next < sites.length) {
    const site = sites[next++];
    try {
      const response = await within(25000, page.goto(`https://${site}/`, { timeout: 20000, waitUntil: "domcontentloaded" }));
      await sleep(4000);
      await within(3000, page.evaluate(() => window.scrollBy(0, 2000)).catch(() => {}));
      await sleep(1500);
      status[site] = response === "timeout" ? "timeout" : response ? response.status() : "no response";
      // Leave the page before the next site so a stuck one can't hold the tab.
      await within(5000, page.goto("about:blank").catch(() => {}));
    } catch (e) {
      status[site] = `error: ${e.message.split("\n")[0].slice(0, 80)}`;
    }
    done++;
    if (done % 50 === 0) {
      const rate = done / ((Date.now() - started) / 60000);
      console.log(`${done}/${sites.length} sites, ${rate.toFixed(1)}/min`);
      await save();
    }
  }
  await page.close().catch(() => {});
}

async function save() {
  const { hits, sites: hitSites } = await worker.evaluate(() => ({
    hits: Object.fromEntries(globalThis.__hits),
    sites: Object.fromEntries([...globalThis.__hitSites].map(([k, v]) => [k, [...v]])),
  }));
  writeFileSync(join(outDir, "hits.json"), JSON.stringify({ crawled: done, total: sites.length, status, hits, hitSites }));
}

await Promise.all(Array.from({ length: tabs }, lane));
await save();
const ok = Object.values(status).filter((s) => typeof s === "number" && s < 400).length;
console.log(`done: ${done} sites (${ok} loaded OK) in ${Math.round((Date.now() - started) / 60000)} min -> .cache/crawl/hits.json`);
await browser.close();

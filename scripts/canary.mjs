// Breakage canary + rule-match crawl: loads real sites (banks, sign-in pages,
// shops, news, Cloudflare-fronted sites) with a baseline and with the
// candidate build, interleaved site by site so network weather hits both arms
// the same. Records which rules Chrome matched on each page
// (onRuleMatchedDebug, unpacked builds only) and flags sites where the
// candidate lost text, controls or the page itself, or met a bot check the
// baseline didn't (scripts/lib/canaryVerdict.mjs). Exits 1 when any site is
// flagged, so a list update can be held until someone looks.
//
//   npm run build && npm run canary                          baseline = no extension
//   npm run canary -- --base <unzipped previous release>     baseline = that build
//   options: --ext <dir> (default dist/chrome), --rounds N (default 2),
//            --sites a,b, --out <file> (default .cache/canary/<time>.json)
//
// Needs network. Headless Chrome gets bot-checked on some sites, and DataDome
// sites (Forbes, NYTimes) wall the whole IP after a few dozen loads, so a
// "bot check" flag needs a rerun of that site alone before it means anything.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import { chromePath } from "./chrome-for-testing.mjs";
import { canaryVerdict } from "./lib/canaryVerdict.mjs";

const { values: opt } = parseArgs({
  options: { base: { type: "string", default: "none" }, ext: { type: "string", default: "dist/chrome" }, rounds: { type: "string", default: "2" }, sites: { type: "string" }, out: { type: "string" } },
});
const root = resolve(".");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = opt.sites?.split(",") ?? [
  // sign-in
  "https://accounts.google.com/", "https://login.live.com/", "https://github.com/login", "https://www.paypal.com/signin",
  "https://appleid.apple.com/", "https://claude.ai/login", "https://www.notion.so/login", "https://slack.com/signin", "https://www.dropbox.com/login",
  // banks and payments
  "https://www.chase.com/", "https://www.bankofamerica.com/", "https://www.wellsfargo.com/", "https://www.capitalone.com/",
  "https://www.americanexpress.com/", "https://www.citi.com/", "https://www.discover.com/", "https://www.usbank.com/", "https://stripe.com/",
  // shops
  "https://www.amazon.com/", "https://www.ebay.com/", "https://www.walmart.com/", "https://www.target.com/", "https://www.bestbuy.com/",
  "https://www.etsy.com/", "https://www.homedepot.com/", "https://www.costco.com/", "https://www.allbirds.com/", "https://www.ikea.com/us/en/",
  // news and ad-heavy
  "https://www.nytimes.com/", "https://edition.cnn.com/", "https://weather.com/", "https://www.bbc.com/news", "https://www.theguardian.com/us",
  "https://www.forbes.com/", "https://www.yahoo.com/", "https://www.cnet.com/", "https://harrypotter.fandom.com/wiki/Hermione_Granger",
  // Cloudflare-fronted
  "https://discord.com/", "https://medium.com/", "https://chatgpt.com/", "https://www.canva.com/", "https://zoom.us/",
  "https://www.udemy.com/", "https://www.coinbase.com/", "https://www.npmjs.com/",
  // everyday
  "https://www.google.com/search?q=best+running+shoes", "https://www.youtube.com/", "https://www.reddit.com/", "https://www.linkedin.com/",
  "https://x.com/", "https://en.wikipedia.org/wiki/Moat", "https://stackoverflow.com/questions", "https://www.doordash.com/",
  "https://open.spotify.com/", "https://www.netflix.com/", "https://www.microsoft.com/en-us/",
];

/** ruleset id -> rule id -> action type, from the build's static rule files. */
function staticActions(ext) {
  const actions = {};
  for (const r of JSON.parse(readFileSync(join(ext, "rules", "rulesets.json"), "utf8"))) {
    actions[r.id] = Object.fromEntries(JSON.parse(readFileSync(join(ext, "rules", r.file), "utf8")).map((x) => [x.id, x.action.type]));
  }
  return actions;
}

async function launchArm(label, ext) {
  if (ext && !existsSync(join(ext, "manifest.json"))) throw new Error(`${ext} has no manifest.json (build it or unzip it first)`);
  const browser = await puppeteer.launch({
    executablePath: await chromePath(root), headless: true, pipe: true,
    userDataDir: mkdtempSync(join(tmpdir(), "moat-canary-")), enableExtensions: ext ? [ext] : [], args: ["--window-size=1366,850"],
  });
  let worker = null;
  if (ext) {
    worker = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"))).worker();
  }
  return { label, ext, browser, worker, actions: ext ? staticActions(ext) : null, ua: (await browser.userAgent()).replace("HeadlessChrome", "Chrome") };
}

// The DevTools attachment keeps the worker alive; if it restarts anyway the listener is gone and drain() says so.
const listen = (w) => w.evaluate(() => {
  globalThis.__canaryMatches = [];
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((i) => {
    if (i.request.tabId >= 0) globalThis.__canaryMatches.push([i.request.url, i.request.type, i.rule.rulesetId, i.rule.ruleId]);
  });
});
const drain = (w) => w.evaluate(async () => {
  const m = globalThis.__canaryMatches;
  if (!m) return null;
  globalThis.__canaryMatches = [];
  const extra = [...await chrome.declarativeNetRequest.getDynamicRules(), ...await chrome.declarativeNetRequest.getSessionRules()];
  return { matches: m, extraActions: Object.fromEntries(extra.map((r) => [r.id, r.action.type])) };
});

async function visit(arm, url) {
  const page = await arm.browser.newPage();
  await page.setUserAgent(arm.ua);
  await page.setViewport({ width: 1366, height: 850 });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  let navErr = null, blocked = 0;
  cdp.on("Network.loadingFailed", (e) => { if (e.errorText === "net::ERR_BLOCKED_BY_CLIENT") blocked++; });
  await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch((e) => (navErr = e.message.split("\n")[0].slice(0, 80)));
  await sleep(5000); // late scripts, consent banners, lazy content
  const dom = await page.evaluate(() => ({
    text: document.body?.innerText.length ?? 0,
    inputs: document.querySelectorAll("input:not([type=hidden]),button,select,textarea").length,
    title: document.title.slice(0, 60),
    wall: !!document.querySelector('iframe[src*="captcha-delivery.com"]'),
  })).catch(() => ({ text: 0, inputs: 0, title: "", wall: false }));
  await page.close();
  const result = { navErr, blocked, ...dom };
  if (arm.worker) {
    const d = await drain(arm.worker);
    if (!d) { result.matchesLost = true; await listen(arm.worker); }
    result.matches = (d?.matches ?? []).map(([u, type, rulesetId, ruleId]) => {
      const action = arm.actions[rulesetId]?.[ruleId] ?? d.extraActions[ruleId] ?? "?";
      let host = "?"; try { host = new URL(u).host; } catch { /* keep "?" */ }
      return { host, type, rulesetId, ruleId, action };
    });
  }
  return result;
}

const base = await launchArm("base", opt.base === "none" ? null : resolve(opt.base));
const cand = await launchArm("cand", resolve(opt.ext));
await Promise.all([base, cand].filter((a) => a.worker).map((a) => listen(a.worker)));
await sleep(8000); // let both builds finish enabling rulesets

const sites = {};
const rounds = Number(opt.rounds);
for (const url of SITES) {
  sites[url] = { base: [], cand: [] };
  for (let r = 0; r < rounds; r++) {
    for (const arm of r % 2 === 0 ? [base, cand] : [cand, base]) sites[url][arm.label].push(await visit(arm, url));
  }
  const s = sites[url];
  s.reasons = canaryVerdict(s.base, s.cand);
  const blocks = (runs) => new Set(runs.flatMap((x) => x.matches ?? []).filter((m) => m.action === "block" || m.action === "redirect").map((m) => `${m.host} ${m.rulesetId}`));
  const baseBlocks = blocks(s.base);
  s.newBlocks = [...blocks(s.cand)].filter((b) => !baseBlocks.has(b));
  const textOf = (runs) => Math.max(0, ...runs.map((x) => x.text));
  console.log(`${s.reasons.length ? "FLAG" : "ok  "}  ${new URL(url).host.padEnd(30)} text ${String(textOf(s.base)).padStart(6)} -> ${String(textOf(s.cand)).padStart(6)}  ${s.reasons.join(", ")}`);
}
await base.browser.close();
await cand.browser.close();

// Rule-match totals across every site for the candidate: which rulesets do the work, and on which hosts.
const byRuleset = {};
for (const s of Object.values(sites)) {
  for (const m of s.cand.flatMap((x) => x.matches ?? [])) {
    const k = `${m.rulesetId} ${m.action}`;
    byRuleset[k] ??= { count: 0, hosts: {} };
    byRuleset[k].count++;
    byRuleset[k].hosts[m.host] = (byRuleset[k].hosts[m.host] ?? 0) + 1;
  }
}
console.log("\nRule matches on the candidate (ruleset, action, matches, top hosts):");
for (const [k, v] of Object.entries(byRuleset).sort((a, b) => b[1].count - a[1].count)) {
  const top = Object.entries(v.hosts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([h, n]) => `${h} ${n}`).join(", ");
  console.log(`  ${k.padEnd(40)} ${String(v.count).padStart(5)}  ${top}`);
}

const flagged = Object.entries(sites).filter(([, s]) => s.reasons.length);
for (const [url, s] of flagged) {
  console.log(`\nFLAG ${url}: ${s.reasons.join(", ")}`);
  for (const b of s.newBlocks.slice(0, 15)) console.log(`  blocked only by the candidate: ${b}`);
}
const out = resolve(opt.out ?? join(".cache", "canary", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ base: opt.base, ext: opt.ext, rounds, sites, byRuleset }, null, 1));
console.log(`\n${flagged.length} of ${SITES.length} sites flagged. Full results: ${out}`);
process.exitCode = flagged.length ? 1 : 0;

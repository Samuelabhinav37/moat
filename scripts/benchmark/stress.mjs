// Stress tests for Moat: many tabs, rapid navigation, tab churn, a DOM
// storm, settings thrash, getMatchedRules quota exhaustion and big custom
// lists. Local pages under many hostnames (every host is mapped to a local
// server), so each run is repeatable. Results: .cache/benchmark/stress-results.json
//   npm run build && node scripts/benchmark/stress.mjs
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromePath } from "../chrome-for-testing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const dir = join(root, ".cache", "benchmark");
mkdirSync(dir, { recursive: true });
const exe = await chromePath(root);
const EXT = join(root, "dist", "chrome");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AD = "securepubads.g.doubleclick.net";
let adHits = 0;

const heavyPage = (n = 40) => `<!doctype html><title>heavy</title><body>
  <h1 class="article">Headline</h1>
  <div id="ad_banner" style="height:90px">ad</div><div class="ad-slot" style="height:90px">ad</div>
  ${Array.from({ length: n }, (_, i) => `<p class="article c${i}">Paragraph ${i} with some text.</p>`).join("")}
  <div id="slot" style="width:300px;height:250px"><iframe src="http://${AD}/gampad/ads?i" width="300" height="250"></iframe></div>
  <script src="http://${AD}/tag/js/gpt.js"></script></body>`;

// Adds thousands of elements over ~8s, including ad-named ones late.
const stormPage = `<!doctype html><title>storm</title><body><h1 class="article">Storm</h1><div id="feed"></div><script>
  let n = 0; const feed = document.getElementById("feed");
  const t = setInterval(() => {
    for (let i = 0; i < 250; i++, n++) {
      const d = document.createElement("div");
      d.className = n % 50 === 0 ? "ad-slot late-ad" : "post c" + (n % 97);
      d.style.height = "20px"; d.textContent = n % 50 === 0 ? "late ad" : "post " + n;
      feed.appendChild(d);
    }
    if (n >= 5000) { clearInterval(t); window.__done = performance.now(); }
  }, 60);
</script></body>`;

const server = createServer((q, s) => {
  const host = (q.headers.host ?? "").split(":")[0];
  if (host === AD) { adHits++; s.writeHead(200, { "content-type": "text/javascript" }); return s.end("window.__adLoaded=1"); }
  s.writeHead(200, { "content-type": "text/html" });
  s.end(host.startsWith("storm.") ? stormPage : heavyPage());
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

async function launch(withMoat = true) {
  const b = await puppeteer.launch({
    executablePath: exe, headless: true, pipe: true, protocolTimeout: 180000,
    userDataDir: mkdtempSync(join(tmpdir(), "stress-")),
    ...(withMoat ? { enableExtensions: [EXT] } : {}),
    args: [`--host-resolver-rules=MAP * 127.0.0.1:${port}`, "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable"],
  });
  let sw = null, extId = null;
  if (withMoat) {
    const t = await b.waitForTarget((x) => x.type() === "service_worker" && x.url().startsWith("chrome-extension://"));
    extId = new URL(t.url()).host;
    sw = await t.worker();
    await sleep(7000);
    for (const p of await b.pages()) if (p.url().includes("welcome.html")) await p.close();
  }
  return { b, sw, extId };
}
// performance.memory doesn't exist in a service worker; ask DevTools.
const heapMB = async (sw) => {
  try {
    const { usedSize } = await sw.client.send("Runtime.getHeapUsage");
    return Math.round((usedSize / 1048576) * 10) / 10;
  } catch {
    return null;
  }
};
const hidden = (p) => p.$eval("#ad_banner", (e) => getComputedStyle(e).display === "none").catch(() => null);
const out = {};
const log = (k, v) => { out[k] = v; console.log(k, JSON.stringify(v)); };

// 1. Many tabs at once.
{
  const { b, sw } = await launch();
  const before = await heapMB(sw);
  const t0 = Date.now();
  const pages = await Promise.all(Array.from({ length: 25 }, async (_, i) => { const p = await b.newPage(); await p.goto(`http://tab${i}.stress.test/`, { waitUntil: "load", timeout: 60000 }).catch(() => {}); return p; }));
  await sleep(4000);
  const hid = (await Promise.all(pages.map(hidden))).filter(Boolean).length;
  log("1_many_tabs", { tabs: 25, allLoadedMs: Date.now() - t0, adHiddenInTabs: hid, adRequestsLeaked: adHits, workerHeapBeforeMB: before, workerHeapAfterMB: await heapMB(sw) });
  await b.close(); adHits = 0;
}

// 2. Rapid navigation in one tab, 150 different sites.
{
  const { b, sw } = await launch();
  const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const before = await heapMB(sw); const t0 = Date.now();
  for (let i = 0; i < 150; i++) await p.goto(`http://site${i}.nav.test/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(3000);
  log("2_rapid_nav", { navigations: 150, totalMs: Date.now() - t0, lastPageAdHidden: await hidden(p), adRequestsLeaked: adHits, pageErrors: errs.length, workerAlive: !!b.targets().find((t) => t.type() === "service_worker"), workerHeapBeforeMB: before, workerHeapAfterMB: await heapMB(sw) });
  await b.close(); adHits = 0;
}

// 3. Tab churn: open and close 100 tabs; heap trend.
{
  const { b, sw } = await launch();
  const samples = [await heapMB(sw)];
  for (let i = 0; i < 100; i++) {
    const p = await b.newPage(); await p.goto(`http://churn${i}.test/`, { waitUntil: "domcontentloaded" }).catch(() => {}); await p.close();
    if (i % 25 === 24) { await sleep(1500); samples.push(await heapMB(sw)); }
  }
  log("3_tab_churn", { tabs: 100, workerHeapMB_every25: samples });
  await b.close(); adHits = 0;
}

// 4. DOM storm: CPU with vs without Moat, and late ads hidden.
{
  const res = {};
  for (const withMoat of [false, true]) {
    const { b } = await launch(withMoat);
    const p = await b.newPage();
    const cdp = await p.createCDPSession(); await cdp.send("Performance.enable");
    await p.goto("http://storm.stress.test/", { waitUntil: "load" });
    await p.waitForFunction(() => window.__done, { timeout: 30000 }).catch(() => {});
    await sleep(3000);
    const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const late = await p.evaluate(() => { const els = [...document.querySelectorAll(".late-ad")]; return { total: els.length, hidden: els.filter((e) => getComputedStyle(e).display === "none").length }; });
    res[withMoat ? "moat" : "none"] = { scriptSec: +m.ScriptDuration.toFixed(2), taskSec: +m.TaskDuration.toFixed(2), styleRecalcSec: +(m.RecalcStyleDuration ?? 0).toFixed(2), lateAds: late };
    await b.close();
  }
  log("4_dom_storm", res);
}

// 5. Settings thrash: 60 rapid toggles, then check the final state.
{
  const { b, sw, extId } = await launch();
  const o = await b.newPage(); await o.goto(`chrome-extension://${extId}/options.html`);
  await o.evaluate(async () => {
    const sends = [];
    for (let i = 0; i < 60; i++) sends.push(chrome.runtime.sendMessage({ type: "set-settings-patch", patch: { cookieBannerAutoReject: i % 2 === 1, hideSeoSpamResults: i % 3 === 0 } }));
    for (let i = 0; i < 20; i++) sends.push(chrome.runtime.sendMessage({ type: "toggle-site", hostname: "thrash.test" }));
    await Promise.all(sends);
  });
  await sleep(3000);
  const state = await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get("settings");
    const scripts = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
    return { cookie: settings.cookieBannerAutoReject, seo: settings.hideSeoSpamResults, paused: settings.disabledSites.includes("thrash.test"), consentRegistered: scripts.includes("moat-consent-rejector") };
  });
  // Last writes: i=59 -> cookie true, seo (59%3===0) false; 20 toggles -> not paused.
  log("5_settings_thrash", { ...state, expected: { cookie: true, seo: false, paused: false, consentRegistered: true }, consistent: state.cookie === true && state.seo === false && state.paused === false && state.consentRegistered === true });
  await b.close();
}

// 6. getMatchedRules quota: 30 quick page loads, then open the popup.
{
  const { b, sw } = await launch();
  const p = await b.newPage();
  for (let i = 0; i < 30; i++) { await p.goto(`http://quota${i}.test/`, { waitUntil: "load" }).catch(() => {}); await sleep(300); }
  await sleep(9000);
  await p.bringToFront();
  await sw.evaluate(() => chrome.action.openPopup());
  const pop = await (await b.waitForTarget((t) => t.url().includes("popup.html"))).asPage(); await sleep(1500);
  const count = await pop.evaluate(() => Number(document.getElementById("count")?.textContent));
  const badge = await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return chrome.action.getBadgeText({ tabId: t.id }); });
  log("6_quota_exhausted", { pageLoads: 30, popupCount: count, badge, expectedAtLeast: 2 });
  await b.close();
}

// 7. Big custom lists: 2,000 always-block domains.
{
  const { b, sw, extId } = await launch();
  const o = await b.newPage(); await o.goto(`chrome-extension://${extId}/options.html`);
  const t0 = Date.now();
  await o.evaluate(async () => { for (let i = 0; i < 2000; i++) await chrome.runtime.sendMessage({ type: "add-custom-domain", field: "customBlockedDomains", hostname: `blocked${i}.example` }); });
  const addMs = Date.now() - t0;
  await sleep(2000);
  const dyn = await sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length);
  const p = await b.newPage(); const cdp = await p.createCDPSession(); await cdp.send("Network.enable");
  let blocked1999 = false; const ids = new Map();
  cdp.on("Network.requestWillBeSent", (e) => ids.set(e.requestId, e.request.url));
  cdp.on("Network.loadingFailed", (e) => { if (e.errorText === "net::ERR_BLOCKED_BY_CLIENT" && (ids.get(e.requestId) ?? "").includes("blocked1999")) blocked1999 = true; });
  await p.goto("http://page.big.test/", { waitUntil: "load" });
  await p.evaluate(() => fetch("http://blocked1999.example/x").catch(() => {})); await sleep(1500);
  const t1 = Date.now(); await o.reload({ waitUntil: "load" }); const optionsLoadMs = Date.now() - t1;
  const t2 = Date.now(); for (let i = 0; i < 5; i++) await p.goto(`http://page${i}.big.test/`, { waitUntil: "load" }); const fivePagesMs = Date.now() - t2;
  log("7_big_custom_lists", { domains: 2000, addAllMs: addMs, dynamicRules: dyn, lastDomainBlocked: blocked1999, settingsPageLoadMs: optionsLoadMs, fiveLocalPageLoadsMs: fivePagesMs, workerHeapMB: await heapMB(sw) });
  await b.close();
}

writeFileSync(`${dir}/stress-results.json`, JSON.stringify(out, null, 1));
server.close();
console.log("done");

// Competitive benchmark: Moat vs uBlock Origin Lite, AdGuard, Ghostery,
// Adblock Plus, and no blocker. Each gets a fresh profile, its own defaults
// and identical tests: the d3ward host list, a set of sites, the Cloudflare
// Turnstile test key, and cnn.com's request storm. Live sites, so numbers
// move day to day. Results: .cache/benchmark/bench-results[-<set>][-<blockers>].json
//   npm run build && node scripts/benchmark/fetch-competitors.mjs
//   node scripts/benchmark/bench.mjs [moat,ubol,...] [--set=ads|tranco] [--sites=N]
// --set=ads (default): ad-heavy news, recipe and weather sites, ~25 minutes.
// --set=tranco: every 5th site of the Tranco top 1000 (.cache/crawl/tranco-top1000.csv),
// adult sites left out, first N (default 150). Then: node scripts/benchmark/report.mjs
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromePath } from "../chrome-for-testing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const SET = flags.set ?? "ads";
const dir = join(root, ".cache", "benchmark");
const exe = await chromePath(root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXT = {
  none: null,
  moat: join(root, "dist", "chrome"),
  ubol: `${dir}/ext/ubol`,
  adguard: `${dir}/ext/adguard`,
  ghostery: `${dir}/ext/ghostery`,
  abp: `${dir}/ext/abp`,
};
const AD_SITES = [
  "https://weather.com/",
  "https://www.forbes.com/",
  "https://www.yahoo.com/",
  "https://www.dailymail.co.uk/home/index.html",
  "https://www.cnn.com/",
  "https://www.espn.com/",
  "https://www.independent.co.uk/",
  "https://www.speedtest.net/",
  "https://www.allrecipes.com/",
  "https://www.simplyrecipes.com/",
  "https://www.theguardian.com/uk",
  "https://www.foxnews.com/",
  "https://www.bbc.com/news",
  "https://www.reuters.com/",
  "https://www.thesun.co.uk/",
];
const ADULT = /porn|xvideo|xnxx|xhamster|sex|onlyfans|chaturbate|stripchat|livejasmin|bongacams|spankbang|redtube|youporn|hentai|erome|camsoda|fapello|nsfw/i;
function trancoSites(n) {
  const rows = readFileSync(join(root, ".cache", "crawl", "tranco-top1000.csv"), "utf8").split(/\r?\n/).map((l) => l.split(",")).filter((r) => r[1]);
  return rows.filter(([rank]) => Number(rank) % 5 === 1).map((r) => r[1].trim()).filter((d) => !ADULT.test(d)).slice(0, n).map((d) => `https://${d}/`);
}
const SITES = SET === "tranco" ? trancoSites(Number(flags.sites ?? 150)) : AD_SITES.slice(0, Number(flags.sites ?? AD_SITES.length));

// Tracker requests are classified with DuckDuckGo's tracker list, which none of
// the blockers here ship as their own, so it doesn't favour any of them.
//   curl -o .cache/benchmark/ddg-tds.json https://staticcdn.duckduckgo.com/trackerblocking/v5/current/extension-tds.json
// Only entries DuckDuckGo blocks by default ("ignore" ones are CDNs and
// widgets it only names for ownership), and never one owned by the same
// company as the page (DuckDuckGo's domain -> company map).
const TDS_FILE = join(dir, "ddg-tds.json");
const TDS = existsSync(TDS_FILE) ? JSON.parse(readFileSync(TDS_FILE, "utf8")) : { trackers: {}, domains: {} };
const TRACKERS = new Set(Object.entries(TDS.trackers).filter(([, t]) => t.default === "block").map(([d]) => d));
const ownerOf = (h) => { const p = h.split("."); for (let i = 0; i < p.length - 1; i++) { const o = TDS.domains[p.slice(i).join(".")]; if (o) return o; } return null; };
if (TRACKERS.size === 0) console.warn("No ddg-tds.json: tracker counts will be 0.");
const SLD = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.in", "com.cn", "co.kr", "com.tr", "com.mx", "co.za", "com.ar", "org.uk", "ne.jp", "or.jp", "com.tw", "com.hk", "com.sg"]);
const site2 = (h) => { const p = h.split("."); return SLD.has(p.slice(-2).join(".")) ? p.slice(-3).join(".") : p.slice(-2).join("."); };
function trackerOf(host) {
  const p = host.split(".");
  for (let i = 0; i < p.length - 1; i++) { const d = p.slice(i).join("."); if (TRACKERS.has(d)) return d; }
  return null;
}
const SHOTS = join(dir, "shots", SET);
const d3 = JSON.parse(readFileSync(`${dir}/d3ward.json`, "utf8"));
const HOSTS = [];
for (const [cat, groups] of Object.entries(d3)) for (const hosts of Object.values(groups)) for (const h of hosts) HOSTS.push({ cat, h });

// Local pages: the host battery, and a Turnstile page (Cloudflare test key).
const batteryPage = `<!doctype html><title>battery</title><script>
  const hosts = ${JSON.stringify(HOSTS.map((x) => x.h))};
  for (const h of hosts) { fetch("https://" + h + "/", { mode: "no-cors" }).catch(() => {}); const i = new Image(); i.src = "https://" + h + "/pixel.gif"; }
</script>`;
const turnstilePage = `<!doctype html><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" data-sitekey="1x00000000000000000000AA" data-callback="ok"></div><script>window.ok=()=>{window.__token=1}</script>`;
const server = createServer((q, s) => {
  s.writeHead(200, { "content-type": "text/html" });
  s.end((q.headers.host ?? "").startsWith("turnstile.") ? turnstilePage : batteryPage);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const AD_RE = /(^|[-_ ])(ad|ads|advert|adverts|advertisement|sponsor|sponsored|dfp|gpt-ad|adslot|ad-slot|adunit|ad-unit|banner-ad|adcontainer|ad-container)([-_ ]|\d|$)/i;
const CMP = ["#onetrust-banner-sdk", "[id^='sp_message_container']", ".fc-consent-root", "#qc-cmp2-container", "#truste-consent-track", "#CybotCookiebotDialog", "#didomi-popup", "#usercentrics-root", ".cmp-app_gdpr", "#cmpbox", "[class*='cookie-banner']", "[id*='cookie-banner']"];

async function launch(name) {
  const t0 = Date.now();
  const b = await puppeteer.launch({
    executablePath: exe, headless: true, pipe: true, protocolTimeout: 180000,
    userDataDir: mkdtempSync(join(tmpdir(), `bench-${name}-`)),
    ...(EXT[name] ? { enableExtensions: [EXT[name]] } : {}),
    args: [`--host-resolver-rules=MAP battery.bench.test 127.0.0.1:${port}, MAP turnstile.bench.test 127.0.0.1:${port}`, "--disable-features=HttpsUpgrades", "--window-size=1280,900"],
  });
  let startup = null;
  if (EXT[name]) {
    await b.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"), { timeout: 90000 });
    startup = Date.now() - t0;
    await sleep(10000);
    for (const p of await b.pages()) {
      const u = p.url();
      if (name === "ghostery" && u.includes("onboarding")) {
        // Ghostery blocks nothing until its onboarding is accepted.
        await p.evaluate(() => { const btn = [...document.querySelectorAll("button, a, ui-button, [role=button]")].find((e) => /continue/i.test(e.textContent || "")); btn?.click(); });
        await sleep(4000);
      }
      if (u.startsWith("chrome-extension://")) await p.close().catch(() => {});
    }
    await sleep(3000);
  }
  return { b, startup };
}

async function newPage(b) {
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  await p.setUserAgent((await b.userAgent()).replace("HeadlessChrome", "Chrome"));
  return p;
}

async function battery(b) {
  const p = await newPage(b);
  const cdp = await p.createCDPSession(); await cdp.send("Network.enable");
  const urls = new Map(); const blockedHosts = new Set();
  cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
  cdp.on("Network.loadingFailed", (e) => { if (e.errorText === "net::ERR_BLOCKED_BY_CLIENT") { try { blockedHosts.add(new URL(urls.get(e.requestId)).hostname); } catch {} } });
  await p.goto("http://battery.bench.test/", { waitUntil: "load" }).catch(() => {});
  await sleep(12000);
  await p.close();
  const byCat = {};
  for (const { cat, h } of HOSTS) { byCat[cat] ??= { blocked: 0, total: 0 }; byCat[cat].total++; if (blockedHosts.has(h)) byCat[cat].blocked++; }
  return { blocked: HOSTS.filter((x) => blockedHosts.has(x.h)).length, total: HOSTS.length, byCat, missed: HOSTS.filter((x) => !blockedHosts.has(x.h) && x.cat !== "OEMs").map((x) => x.h) };
}

async function site(b, url, name) {
  const p = await newPage(b);
  const cdp = await p.createCDPSession(); await cdp.send("Network.enable"); await cdp.send("Performance.enable");
  let reqs = 0, blocked = 0, bytes = 0;
  // Tracker requests: third-party to the page, host on DuckDuckGo's list.
  // "reached" got a response from the network; "stopped" was refused or
  // answered by the extension itself (a stand-in script or pixel).
  const trk = new Map(); let trackersReached = 0, trackersStopped = 0; const reachedTrackers = new Set();
  let pageSite = "", pageOwner = null, docRequest = "";
  cdp.on("Network.requestWillBeSent", (e) => {
    reqs++;
    let h = ""; try { const u = new URL(e.request.url); if (/^https?:$/.test(u.protocol)) h = u.hostname; } catch {}
    // The page's own navigation, followed through redirects (x.com -> www.x.co).
    if (e.type === "Document" && (!docRequest || e.requestId === docRequest)) { docRequest = e.requestId; if (h) { pageSite = site2(h); pageOwner = ownerOf(h); } return; }
    if (e.redirectResponse && trk.has(e.requestId) && !h) { trackersStopped++; trk.delete(e.requestId); return; }
    if (e.redirectResponse || !h) return;
    const t = trackerOf(h);
    if (t && pageSite && site2(h) !== pageSite && !(pageOwner && ownerOf(h) === pageOwner)) trk.set(e.requestId, t);
  });
  cdp.on("Network.responseReceived", (e) => {
    const t = trk.get(e.requestId); if (!t) return;
    if (/^https?:/.test(e.response.url) && !e.response.fromServiceWorker) { trackersReached++; reachedTrackers.add(t); } else trackersStopped++;
    trk.delete(e.requestId);
  });
  cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
  cdp.on("Network.loadingFailed", (e) => {
    if (e.errorText === "net::ERR_BLOCKED_BY_CLIENT") { blocked++; if (trk.has(e.requestId)) trackersStopped++; }
    trk.delete(e.requestId);
  });
  let pageErrors = 0; p.on("pageerror", () => pageErrors++);
  await p.evaluateOnNewDocument(() => {
    window.__lcp = 0; window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  const res = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
  const status = res ? res.status() : 0;
  // CLS before scrolling: wheel input counts as recent input, but lazy
  // content scrolled into view would muddy "how much does the page jump".
  await sleep(6000);
  const cls = await p.evaluate(() => window.__cls).catch(() => null);
  for (let i = 0; i < 4; i++) { await p.mouse.wheel({ deltaY: 700 }).catch(() => {}); await sleep(1000); }
  await p.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(2000);
  let host = ""; try { host = new URL(url).hostname; } catch {}
  mkdirSync(join(SHOTS, name), { recursive: true });
  await p.screenshot({ path: join(SHOTS, name, `${host}.jpg`), type: "jpeg", quality: 45 }).catch(() => {});
  const textLen = await p.evaluate(() => (document.body?.innerText ?? "").trim().length).catch(() => 0);
  const dom = await p.evaluate((reSrc, cmp) => {
    const re = new RegExp(reSrc, "i");
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 100 && r.height >= 50 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05; };
    const host = location.hostname.split(".").slice(-2).join(".");
    let adFrames = 0;
    for (const f of document.querySelectorAll("iframe")) { let h = ""; try { h = new URL(f.src, location.href).hostname; } catch {} if (vis(f) && h && !h.endsWith(host)) adFrames++; }
    let adBoxes = 0;
    for (const el of document.querySelectorAll("div[id],div[class],aside,section[id],ins")) { const n = `${el.id} ${typeof el.className === "string" ? el.className : ""}`; if (re.test(n) && vis(el) && el.getBoundingClientRect().height < 700) adBoxes++; }
    const cookieBanner = cmp.some((s) => [...document.querySelectorAll(s)].some(vis));
    return {
      adFrames, adBoxes, cookieBanner,
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      lcp: window.__lcp || null,
    };
  }, AD_RE.source, CMP).catch(() => ({}));
  const m = Object.fromEntries((await cdp.send("Performance.getMetrics").catch(() => ({ metrics: [] }))).metrics.map((x) => [x.name, x.value]));
  await p.close();
  return {
    url, status, reqs, blocked, kb: Math.round(bytes / 1024), task: m.TaskDuration ?? null, script: m.ScriptDuration ?? null, heap: m.JSHeapUsedSize ? Math.round(m.JSHeapUsedSize / 1048576) : null,
    cls: cls == null ? null : +cls.toFixed(4), trackersReached, trackersStopped, trackerHostsReached: [...reachedTrackers], pageErrors, textLen, ...dom,
  };
}

async function turnstile(b) {
  let pass = 0;
  for (let i = 0; i < 3; i++) {
    const p = await newPage(b);
    await p.goto(`http://turnstile.bench.test/?${i}`, { waitUntil: "load" }).catch(() => {});
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < 15000) { if (await p.evaluate(() => !!window.__token).catch(() => false)) { ok = true; break; } await sleep(250); }
    if (ok) pass++;
    await p.close();
  }
  return pass;
}

async function cnnStorm(b) {
  const p = await newPage(b);
  const cdp = await p.createCDPSession(); await cdp.send("Network.enable");
  let blocked = 0;
  cdp.on("Network.loadingFailed", (e) => { if (e.errorText === "net::ERR_BLOCKED_BY_CLIENT") blocked++; });
  await p.goto("https://www.cnn.com/", { timeout: 45000 }).catch(() => {});
  await sleep(15000);
  await p.close();
  return blocked;
}

async function workerHeap(b) {
  const t = b.targets().find((x) => x.type() === "service_worker" && x.url().startsWith("chrome-extension://"));
  if (!t) return null;
  try {
    const s = await t.createCDPSession();
    const { usedSize } = await s.send("Runtime.getHeapUsage");
    return Math.round(usedSize / 1048576);
  } catch { return null; }
}

const results = {};
for (const name of Object.keys(EXT)) {
  if (only && !only.split(",").includes(name)) continue;
  const t0 = Date.now();
  const { b, startup } = await launch(name);
  const r = { startup };
  r.battery = await battery(b);
  r.sites = [];
  for (const [i, url] of SITES.entries()) {
    r.sites.push(await site(b, url, name));
    if (SITES.length > 20 && i % 10 === 9) {
      console.log(`${name}: ${i + 1}/${SITES.length}`);
      // Partial save, so a stopped run keeps what it measured.
      writeFileSync(`${dir}/bench-results${SET === "ads" ? "" : "-" + SET}${only ? "-" + only.replace(/,/g, "_") : ""}.partial.json`, JSON.stringify({ ...results, [name]: r }, null, 1));
    }
  }
  r.turnstile = await turnstile(b);
  r.cnnBlocked15s = await cnnStorm(b);
  r.workerHeapMB = await workerHeap(b);
  await b.close();
  results[name] = r;
  const s = r.sites;
  const sum = (f) => s.reduce((a, x) => a + (x[f] ?? 0), 0);
  console.log(`${name}: battery ${r.battery.blocked}/${r.battery.total} | blocked ${sum("blocked")} reqs ${sum("reqs")} | ${Math.round(sum("kb") / 1024)}MB | adFrames ${sum("adFrames")} adBoxes ${sum("adBoxes")} cookieBanners ${s.filter((x) => x.cookieBanner).length} | turnstile ${r.turnstile}/3 | cnn ${r.cnnBlocked15s} | worker ${r.workerHeapMB}MB | startup ${startup}ms | ${Math.round((Date.now() - t0) / 1000)}s`);
  writeFileSync(`${dir}/bench-results${SET === "ads" ? "" : "-" + SET}${only ? "-" + only.replace(/,/g, "_") : ""}.json`, JSON.stringify(results, null, 1));
}
server.close();
console.log("done");

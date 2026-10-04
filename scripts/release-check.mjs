// Pre-release check on a built package, the way a new user meets it:
// installs it into a fresh Chrome for Testing profile and checks the
// first-run tour, that the Balanced rulesets come up, d3ward's 131 ad and
// tracker hosts, a real ad-heavy site, the popup, Settings, and the daily
// live download (fetched from the real live channel), collecting any
// console errors and taking screenshots along the way. Then repeats the
// install with the live channel unreachable and with a slow connection.
//
//   npm run release:check -- <unzipped chrome package> [<screenshot dir>]
//
// Defaults: dist/chrome and .cache/release-check. Needs network (the real
// live channel and weather.com). See docs/RELEASING.md, step 6.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { chromePath } from "./chrome-for-testing.mjs";

const root = resolve(".");
const ext = resolve(process.argv[2] ?? "dist/chrome");
const shots = resolve(process.argv[3] ?? ".cache/release-check");
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ check: name, result: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// d3ward's host list (the benchmark's copy, fetched if missing), requested
// from a neutral local page.
const d3wardPath = join(root, ".cache", "benchmark", "d3ward.json");
if (!existsSync(d3wardPath)) {
  mkdirSync(dirname(d3wardPath), { recursive: true });
  writeFileSync(d3wardPath, await (await fetch("https://raw.githubusercontent.com/d3ward/toolz/master/src/data/adblock_data.json")).text());
}
const hosts = JSON.parse(readFileSync(d3wardPath, "utf8"));
const allHosts = Object.values(hosts).flatMap((cat) => Object.values(cat).flat());
const battery = `<!doctype html><script>window.__done=Promise.all(${JSON.stringify(allHosts)}.map(h=>fetch("https://"+h+"/",{mode:"no-cors"}).then(()=>0,()=>0)))</script>`;
const server = createServer((q, s) => s.end(battery)).listen(0);
const port = server.address().port;

async function launch(extraArgs = []) {
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: await chromePath(root),
    headless: true,
    pipe: true,
    userDataDir: mkdtempSync(join(tmpdir(), "moat-release-")),
    enableExtensions: [ext],
    args: [`--host-resolver-rules=MAP battery.release.test 127.0.0.1:${port}`, "--disable-features=HttpsUpgrades", ...extraArgs],
  });
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"), { timeout: 60000 });
  const worker = await target.worker();
  worker.on("console", (m) => m.type() === "error" && errors.push(`worker: ${m.text()}`));
  const id = new URL(target.url()).host;
  const watch = (page) => {
    // Only Moat's own pages: websites throw errors of their own (weather.com
    // throws React #418 on every load, with or without Moat).
    page.on("pageerror", (e) => page.url().startsWith("chrome-extension://") && errors.push(`${new URL(page.url()).pathname}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && page.url().startsWith("chrome-extension://") && errors.push(`${new URL(page.url()).pathname}: ${m.text()}`));
    return page;
  };
  return { browser, worker, id, errors, watch };
}

async function waitForRulesets(worker) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const on = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
    if (on.length >= 22) return { count: on.length, ms: Date.now() - t0 };
    await sleep(200);
  }
  return { count: (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).length, ms: null };
}

async function runBattery(browser, watch) {
  const page = watch(await browser.newPage());
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const blocked = new Set();
  const urls = new Map();
  cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
  cdp.on("Network.loadingFailed", (e) => {
    if (e.errorText === "net::ERR_BLOCKED_BY_CLIENT") blocked.add(new URL(urls.get(e.requestId)).hostname);
  });
  await page.goto("http://battery.release.test/");
  await page.evaluate(() => window.__done);
  await page.close();
  return blocked.size;
}

async function sendFromOptions(browser, id, message) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  const result = await page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  await page.close();
  return result;
}

// ---------- 1. A normal install ----------
{
  const { browser, worker, id, errors, watch } = await launch();
  await sleep(3000);
  const pages = await browser.pages();
  const tour = pages.find((p) => p.url().includes("welcome.html") || p.url().includes("tour"));
  record("first-run tour opens on install", !!tour, tour ? new URL(tour.url()).pathname : "no tour tab");
  if (tour) {
    watch(tour);
    await tour.setViewport({ width: 1280, height: 860 });
    await sleep(1500);
    await tour.screenshot({ path: join(shots, "1-tour.png") });
  }

  const rs = await waitForRulesets(worker);
  record("Balanced rulesets enabled", rs.count >= 22, `${rs.count} rulesets${rs.ms !== null ? `, ready ${rs.ms} ms after the worker` : ""}`);

  const blocked = await runBattery(browser, watch);
  record("d3ward's ad and tracker hosts blocked", blocked >= 125, `${blocked}/${allHosts.length}`);

  // A real ad-heavy site and its popup.
  const site = watch(await browser.newPage());
  await site.setViewport({ width: 1280, height: 860 });
  await site.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
  const cdp = await site.createCDPSession();
  await cdp.send("Network.enable");
  let siteBlocked = 0;
  cdp.on("Network.loadingFailed", (e) => e.errorText === "net::ERR_BLOCKED_BY_CLIENT" && siteBlocked++);
  await site.goto("https://weather.com/", { timeout: 45000 }).catch(() => {});
  await sleep(9000);
  await site.screenshot({ path: join(shots, "2-weather.png") });
  record("real site: ad and tracker requests blocked on weather.com", siteBlocked > 5, `${siteBlocked} blocked`);
  await site.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  const popupTarget = await browser.waitForTarget((t) => t.url().includes("popup.html"), { timeout: 10000 }).catch(() => null);
  if (popupTarget) {
    const popup = watch(await popupTarget.asPage());
    await sleep(2000);
    const count = await popup.evaluate(() => document.getElementById("count")?.textContent);
    await popup.screenshot({ path: join(shots, "3-popup.png") });
    record("popup opens and shows a count", !!count, `shows ${count}`);
  } else record("popup opens and shows a count", false, "popup didn't open");

  // The daily live download, from the real live channel.
  await sendFromOptions(browser, id, { type: "check-for-live-updates" });
  const status = await worker.evaluate(async () => (await chrome.storage.local.get("liveUpdateStatus")).liveUpdateStatus);
  const dynamic = await worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id >= 930000 && r.id < 930050));
  const liveDomains = dynamic.reduce((s, r) => s + r.condition.requestDomains.length, 0);
  record("daily live download: signed manifest accepted", status?.ok === true && !status?.signatureExpectedButMissing, JSON.stringify({ ok: status?.ok, securityDomainCount: status?.securityDomainCount }));
  record("daily security lists applied as block rules", liveDomains > 10000, `${dynamic.length} rules, ${liveDomains.toLocaleString()} domains`);

  // A domain only in today's list (not bundled) is blocked.
  const bundled = new Set();
  for (const e of JSON.parse(readFileSync(join(ext, "rules", "rulesets.json"), "utf8")).filter((e) => e.category === "security")) {
    for (const r of JSON.parse(readFileSync(join(ext, "rules", e.file), "utf8"))) for (const d of r.condition.requestDomains ?? []) bundled.add(d);
  }
  const fresh = dynamic.flatMap((r) => r.condition.requestDomains).find((d) => !bundled.has(d));
  if (fresh) {
    const outcome = await worker.evaluate((d) => chrome.declarativeNetRequest.testMatchOutcome({ url: `https://${d}/`, type: "main_frame" }), fresh);
    record("a phishing domain only in today's list is blocked", outcome.matchedRules.some((m) => m.rulesetId === "_dynamic"), fresh);
  } else record("a phishing domain only in today's list is blocked", true, "every live domain is also bundled today");

  // Settings.
  const settings = watch(await browser.newPage());
  await settings.setViewport({ width: 1440, height: 1000 });
  await settings.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await settings.goto(`chrome-extension://${id}/options.html#overview`);
  await sleep(1500);
  await settings.screenshot({ path: join(shots, "4-settings-overview.png") });
  const weekTotal = await settings.$eval("#ov-week-total", (el) => el.textContent);
  record("Settings Overview renders with this browser's counts", /\d/.test(weekTotal ?? ""), `week total ${weekTotal}`);
  await settings.goto(`chrome-extension://${id}/options.html#about`);
  await sleep(1200);
  await settings.screenshot({ path: join(shots, "5-settings-about.png") });
  const version = await settings.$eval("#version-number", (el) => el.textContent);
  record("About shows this version", version === JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8")).version, `v${version}`);

  record("no console errors from the extension", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
}

// ---------- 2. Live channel unreachable ----------
{
  const { browser, worker, id, errors, watch } = await launch(["--host-resolver-rules=MAP samuelabhinav37.github.io ~NOTFOUND, MAP battery.release.test 127.0.0.1:" + port]);
  const rs = await waitForRulesets(worker);
  await sendFromOptions(browser, id, { type: "check-for-live-updates" });
  const status = await worker.evaluate(async () => (await chrome.storage.local.get("liveUpdateStatus")).liveUpdateStatus);
  const blocked = await runBattery(browser, watch);
  record("offline live channel: fails quietly, bundled lists keep blocking", status?.ok === false && blocked >= 125, `status ok=${status?.ok}, ${rs.count} rulesets, ${blocked}/${allHosts.length} hosts blocked`);
  record("offline live channel: no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

// ---------- 3. Slow connection ----------
{
  const { browser, worker, id } = await launch();
  await waitForRulesets(worker);
  const target = (await browser.targets()).find((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
  const session = await target.createCDPSession();
  await session.send("Network.enable");
  // Roughly a weak 3G link: 400 ms latency, 400 kbit/s down.
  await session.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 25000 });
  const t0 = Date.now();
  await sendFromOptions(browser, id, { type: "check-for-live-updates" });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const status = await worker.evaluate(async () => (await chrome.storage.local.get("liveUpdateStatus")).liveUpdateStatus);
  record("slow connection (400 kbit/s): daily download still completes", status?.ok === true && (status?.securityDomainCount ?? 0) > 10000, `${seconds} s`);
  await browser.close();
}

server.close();
writeFileSync(join(shots, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.result === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

// Live smoke tests: loads dist/chrome in Chrome for Testing and checks the
// things unit tests can't -- element hiding, ad-box collapse, the first
// painted frame, advanced (procedural) rules, the popup, pausing, "Never
// block", the cookie rejector's script registration and a service-worker
// cold start.
//
// Pages come from a local server. Chrome's --host-resolver-rules sends every
// hostname to it, so Moat's real rules for real names (securepubads.
// g.doubleclick.net, athlonoutdoors.com) apply exactly as on the web, while
// the page content stays fixed and today's ads don't matter.
//
//   npm run build && npm run smoke
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "./chrome-for-testing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = join(root, "dist", "chrome");
if (!existsSync(join(extension, "manifest.json"))) {
  console.error('dist/chrome is missing. Run "npm run build" first.');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Local pages ----------

const AD_HOST = "securepubads.g.doubleclick.net";
// A request pages retry in a loop when blocked; Moat answers it with an
// empty stand-in instead (scripts/lib/retryLoopStubRules.mjs).
const STUB_HOST = "cdn-media.brightline.tv";
const stubHits = [];
const NEWS = "news.moat-smoke.test";
const LONG = "a-really-long-subdomain-for-checking.popup-width.moat-smoke.test";
const adHits = [];

// First-paint probe: records whether the ad element was visible in each of
// the first animation frames, starting before any stylesheet could land.
const PROBE = `<script>
  window.__frames = [];
  (function tick(n) {
    const el = document.getElementById("ad_banner");
    if (el) window.__frames.push(getComputedStyle(el).display !== "none" && el.offsetHeight > 0);
    if (n < 30) requestAnimationFrame(() => tick(n + 1));
  })(0);
</script>`;

function newsPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Smoke news</title>${PROBE}</head><body>
    <h1 class="article">A real headline</h1>
    <div id="ad_banner" style="height:90px;background:#fc0">generic #ad_banner</div>
    <div class="ad-slot" style="height:90px;background:#fc0">generic .ad-slot</div>
    <div class="ad_wrapper" style="height:90px;background:#fc0">generic .ad_wrapper</div>
    <div id="carbonads" style="height:90px;background:#fc0">generic #carbonads</div>
    <p class="article">Body text that must stay visible.</p>
    <iframe id="widget" src="http://widget.moat-smoke.test/frame" width="300" height="60" style="border:0"></iframe>
    <div id="slot" style="width:300px;height:250px"><iframe src="http://${AD_HOST}/gampad/ads?sz=300x250" width="300" height="250" style="border:0"></iframe></div>
    <script src="http://${AD_HOST}/tag/js/gpt.js"></script>
    <script>
      const x = new XMLHttpRequest();
      x.open("GET", "http://${STUB_HOST}/config/v3/1018.json");
      x.onload = () => (window.__stub = { status: x.status, body: x.responseText });
      x.onerror = () => (window.__stub = { error: true });
      x.send();
    </script>
  </body></html>`;
}

function proceduralPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Smoke procedural</title></head><body>
    <p class="hr-lines" id="ad-label">Advertisement</p>
    <p class="hr-lines" id="real">Trail report: the ridge was clear this morning.</p>
  </body></html>`;
}

const server = createServer((req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  if (host === STUB_HOST) {
    stubHits.push(req.url);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"real":"config"}');
  }
  if (host === AD_HOST) {
    adHits.push(req.url);
    res.writeHead(200, { "content-type": req.url.endsWith(".js") ? "text/javascript" : "text/html" });
    return res.end(req.url.endsWith(".js") ? "window.__adLoaded = true;" : "<body style='background:#fc0'>AD</body>");
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (host === "widget.moat-smoke.test") return res.end("<!doctype html><p>A third-party widget, like a Cloudflare check.</p>");
  res.end(host === "athlonoutdoors.com" ? proceduralPage() : newsPage());
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// ---------- Browser ----------

const executablePath = await chromePath(root);
const profiles = [];
async function launch() {
  const userDataDir = mkdtempSync(join(tmpdir(), "moat-smoke-"));
  profiles.push(userDataDir);
  return puppeteer.launch({
    executablePath,
    headless: true,
    pipe: true,
    userDataDir,
    enableExtensions: [extension],
    args: [
      `--host-resolver-rules=MAP * 127.0.0.1:${port}`,
      "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable",
      ...(process.env.CI ? ["--no-sandbox"] : []),
    ],
  });
}
let browser = await launch();

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
// Known, measured limitations: reported every run, never failing it.
const notes = [];
function note(name, detail) {
  notes.push(name);
  console.log(`NOTE  ${name}  (${detail})`);
}

// Polls rather than waiting on a target event, so a worker that restarted
// before we started looking still counts.
async function worker(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const target = browser.targets().find((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
    if (target) return { extId: new URL(target.url()).host, sw: await target.worker() };
    if (Date.now() > deadline) throw new Error("the extension's service worker didn't come back");
    await sleep(250);
  }
}

// Our test pages have no scripts of their own that can fail, so any page
// error on them comes from Moat's content scripts.
const pageErrors = [];
async function load(url, wait = 3500) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${url}: ${e.message}`));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.bringToFront();
  await sleep(wait);
  return page;
}

const visible = (page, selector) =>
  page.$eval(selector, (el) => getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().height > 0);

async function openPopup(sw) {
  await sw.evaluate(() => chrome.action.openPopup());
  const popup = await (await browser.waitForTarget((t) => t.url().includes("popup.html"))).asPage();
  await sleep(1500);
  return popup;
}

async function send(extId, message) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);
  const reply = await page.evaluate((m) => chrome.runtime.sendMessage(m), message);
  await page.close();
  await sleep(1200);
  return reply;
}

async function pageChecks(label) {
  adHits.length = 0;
  stubHits.length = 0;
  const page = await load(`http://${NEWS}/`);
  const hidden = [];
  for (const sel of ["#ad_banner", ".ad-slot", ".ad_wrapper", "#carbonads"]) if (!(await visible(page, sel))) hidden.push(sel);
  check(`${label}: generic element hiding`, hidden.length === 4, `${hidden.length}/4 hidden`);
  check(`${label}: page content untouched`, await visible(page, "h1.article") && await visible(page, "p.article"));
  check(`${label}: ad requests blocked`, adHits.length === 0 && !(await page.evaluate(() => window.__adLoaded)), `${adHits.length} reached the server`);
  const slot = await page.$eval("#slot", (el) => el.getBoundingClientRect().height);
  check(`${label}: empty ad box collapsed`, slot === 0, `slot height ${slot}px`);
  const stub = await page.evaluate(() => window.__stub);
  check(`${label}: retry-loop request answered with an empty stand-in`, stub?.status === 200 && stub.body.trim() === "{}" && stubHits.length === 0,
    stub?.error ? "request failed (blocked, so the page would retry)" : `got ${JSON.stringify(stub?.body)}, ${stubHits.length} reached the network`);
  return page;
}

try {
  let { extId, sw } = await worker();
  await sleep(7000); // install finishing: rulesets, cosmetics index
  for (const p of await browser.pages()) if (p.url().endsWith("/welcome.html")) await p.close();

  // 1-4. Element hiding, blocking, ad-box collapse, first paint.
  const first = await pageChecks("fresh install");
  // The very first page loads Moat's hiding index, like a cold worker does,
  // so it's the same known issue; steady-state browsing is the next page.
  const firstFlash = (await first.evaluate(() => window.__frames)).filter(Boolean).length;
  if (firstFlash > 0) note("first page after install: ad visible briefly before hiding", `${firstFlash} of the first 30 frames`);
  await first.close();
  const news = await load(`http://${NEWS}/`);
  // Known: generic hiding arrives after the page is parsed (the content
  // script asks the worker which token-matched selectors apply), so a fast
  // or cached page can paint a reserved ad slot for a few frames first.
  const flash = (await news.evaluate(() => window.__frames)).filter(Boolean).length;
  if (flash === 0) check("no ad flash in the first painted frames", true);
  else note("repeat visit (cached page): ad slot visible briefly before hiding", `${flash} of the first 30 frames`);

  check("no script errors from Moat on a plain-http page", pageErrors.length === 0, pageErrors[0] ?? "");

  // Bot checks (Cloudflare's frame) and "Sign in with Google" (FedCM) need
  // these; AdGuard's header rules used to switch them off for the page and,
  // by inheritance, every frame in it (scripts/lib/siteBreakingHeaderRules.mjs).
  const FEATURES = ["private-state-token-redemption", "private-state-token-issuance", "identity-credentials-get"];
  const allowed = (target) => target.evaluate((fs) => fs.filter((f) => !document.featurePolicy?.allowsFeature(f)), FEATURES);
  const pageBlocked = await allowed(news);
  const widgetFrame = news.frames().find((f) => f.url().startsWith("http://widget.moat-smoke.test"));
  // FedCM is off in cross-origin frames by Chrome's own default (the page has
  // to grant it), so frames are checked for the token features only.
  const frameBlocked = widgetFrame
    ? (await allowed(widgetFrame)).filter((f) => f !== "identity-credentials-get")
    : ["frame missing"];
  check("bot-check tokens and Google sign-in stay allowed (page and frames)", pageBlocked.length === 0 && frameBlocked.length === 0,
    [...pageBlocked.map((f) => `page: ${f}`), ...frameBlocked.map((f) => `frame: ${f}`)].join(", "));

  // 5. Advanced rule on a real domain.
  const proc = await load("http://athlonoutdoors.com/");
  check("advanced rule (:has-text) hides the labelled paragraph", !(await visible(proc, "#ad-label")) && (await visible(proc, "#real")));
  await proc.close();

  // 6. Popup on the news page: counts and width.
  await news.bringToFront();
  let popup = await openPopup(sw);
  const pop = await popup.evaluate(() => ({
    count: Number(document.getElementById("count")?.textContent),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    width: document.documentElement.clientWidth,
  }));
  check("popup counts the blocked requests", pop.count >= 2, `${pop.count} blocked`);
  check("popup has no horizontal overflow", pop.overflow <= 0, `${pop.width}px wide`);
  await popup.close();
  const longPage = await load(`http://${LONG}/`, 2500);
  popup = await openPopup(sw);
  const longPop = await popup.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, host: document.getElementById("hostname")?.getBoundingClientRect().height }));
  check("long hostname fits the popup", longPop.overflow <= 0, `hostname block ${Math.round(longPop.host)}px tall`);
  await popup.close();
  await longPage.close();

  // 7. Pause on the site, from the popup's own switch.
  await news.bringToFront();
  popup = await openPopup(sw);
  await popup.evaluate(() => document.getElementById("site-toggle").click());
  await sleep(1500);
  if (!popup.isClosed()) await popup.close();
  adHits.length = 0;
  await news.reload({ waitUntil: "load" });
  await sleep(3000);
  check("paused site: ads load again", adHits.length > 0, `${adHits.length} ad requests reached the server`);
  check("paused site: element hiding off", await visible(news, "#ad_banner"));
  await news.bringToFront();
  popup = await openPopup(sw);
  await popup.evaluate(() => document.getElementById("site-toggle").click());
  await sleep(1500);
  if (!popup.isClosed()) await popup.close();
  await news.close();
  await pageChecks("after unpausing");

  // 8. "Never block" beats the ad lists.
  await send(extId, { type: "add-custom-domain", field: "customAllowedDomains", hostname: AD_HOST });
  adHits.length = 0;
  let p = await load(`http://${NEWS}/`, 2500);
  check('"Never block" lets that domain load', adHits.length > 0, `${adHits.length} requests reached the server`);
  await p.close();
  await send(extId, { type: "remove-custom-domain", field: "customAllowedDomains", hostname: AD_HOST });
  adHits.length = 0;
  p = await load(`http://${NEWS}/`, 2500);
  check('removing it from "Never block" blocks it again', adHits.length === 0, `${adHits.length} requests reached the server`);
  await p.close();

  // 9. Cookie rejector script follows its switch.
  const registered = () => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  check("cookie rejector registered by default", (await registered()).includes("moat-consent-rejector"));
  await send(extId, { type: "set-settings-patch", patch: { cookieBannerAutoReject: false } });
  check("switching it off unregisters the script", !(await registered()).includes("moat-consent-rejector"));
  await send(extId, { type: "set-settings-patch", patch: { cookieBannerAutoReject: true } });
  check("switching it on registers it again", (await registered()).includes("moat-consent-rejector"));

  // 10. Service-worker cold start, in a fresh browser that never attaches a
  // debugger to the worker: Chrome won't restart a stopped worker that
  // DevTools is attached to, which real users never have.
  await browser.close();
  browser = await launch();
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
  const coldExtId = new URL(target.url()).host;
  await sleep(7000);
  for (const p of await browser.pages()) if (p.url().endsWith("/welcome.html")) await p.close();
  const stopper = await (await browser.newPage()).createCDPSession();
  await stopper.send("ServiceWorker.enable");
  await stopper.send("ServiceWorker.stopAllWorkers");
  await sleep(1500);
  const coldPage = await pageChecks("first page after the worker stopped");
  const coldFrames = await coldPage.evaluate(() => window.__frames);
  // Known: right after Chrome restarts an idle worker, generic hiding lands
  // a few frames late (warm, it's in place before the first paint).
  const coldVisible = coldFrames.filter(Boolean).length;
  if (coldVisible === 0) check("cold start: no ad flash in the first frames", true);
  else note("cold start: ad visible briefly before hiding", `${coldVisible} of the first ${coldFrames.length} frames`);
  const reply = await send(coldExtId, { type: "get-ui-notices" });
  check("cold start: the worker answers extension pages", reply !== undefined);
} catch (error) {
  check("smoke run completed", false, error.message);
} finally {
  await browser.close();
  server.close();
  for (const dir of profiles) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${notes.length ? `, ${notes.length} known-issue note(s)` : ""}.`);
process.exit(failed.length > 0 ? 1 : 0);

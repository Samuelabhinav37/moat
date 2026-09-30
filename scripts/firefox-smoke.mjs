// Firefox runtime check: loads dist/firefox with web-ext (the same way as
// about:debugging's "Load Temporary Add-on") in headless Firefox, and checks
// that requests to well-known ad and tracker hosts are blocked.
//
// Why it exists: until 0.11.183 nothing ran the Firefox build. Firefox gives
// each extension 30,000 static rules, Moat's default needs ~68,000, and the
// old fallback switched off everything but the security lists, so Firefox
// blocked almost no ads for weeks with CI green.
//
// No internet needed: Firefox's network.dns.forceResolve sends every
// hostname to 127.0.0.1, where this script's server answers. A request that
// fails was stopped by Moat; one that succeeds reached the local server.
//
//   npm run smoke:firefox            (FIREFOX=/path/to/firefox to override)
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const firefox =
  process.env.FIREFOX ??
  (process.platform === "win32" && existsSync("C:/Program Files/Mozilla Firefox/firefox.exe")
    ? "C:/Program Files/Mozilla Firefox/firefox.exe"
    : "firefox");

// Must be blocked by the lists Firefox keeps (ads, trackers, pop-ups, scam,
// badware), whatever else doesn't fit.
const MUST_BLOCK = [
  "pagead2.googlesyndication.com", // ads
  "securepubads.g.doubleclick.net", // ads
  "c.amazon-adsystem.com", // ads
  "ads.pubmatic.com", // ads
  "www.googletagmanager.com", // trackers
  "www.google-analytics.com", // trackers
  "static.hotjar.com", // trackers
  "cdn.taboola.com", // trackers
  "bat.bing.com", // trackers
];
// Must load: proves the page, the server and Firefox's networking work, so a
// blocked result above means Moat and nothing else.
const MUST_LOAD = ["moat-smoke-control.example"];

let port = 0;
// The page reloads once: the Admiral guard is a registered content script
// (background/optionalContentScripts.ts), so it only reaches pages loaded
// after Moat's first start-up registers it.
const page = () => `<!doctype html><title>firefox smoke</title><script>
if (!sessionStorage.moatReloaded) {
  sessionStorage.moatReloaded = "1";
  setTimeout(() => location.reload(), 12000);
} else setTimeout(async () => {
  const hosts = ${JSON.stringify([...MUST_BLOCK, ...MUST_LOAD])};
  const results = await Promise.all(hosts.map((h) =>
    fetch("http://" + h + ":${port}/script.js", { mode: "no-cors", cache: "no-store" }).then(() => [h, "loaded"], () => [h, "blocked"])
  ));
  let admiral = "loaded";
  try { window.admiral = function () {}; } catch { admiral = "blocked"; }
  results.push(["admiral-guard", admiral]);
  await fetch("/result", { method: "POST", body: JSON.stringify(results) });
}, 3000);
</script>`;

let report;
const reported = new Promise((resolve) => (report = resolve));
const server = createServer((req, res) => {
  if (req.url === "/result") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.end("ok");
      report(JSON.parse(body));
    });
    return;
  }
  if (req.url === "/script.js") {
    res.setHeader("content-type", "text/javascript");
    res.end("/* reached the local server */");
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(page());
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
port = server.address().port;

const child = spawn(
  process.execPath,
  [
    "node_modules/web-ext/bin/web-ext.js",
    "run",
    "--target=firefox-desktop",
    "--source-dir=dist/firefox",
    `--firefox=${firefox}`,
    "--arg=-headless",
    "--no-reload",
    "--no-input",
    "--pref=network.dns.forceResolve=127.0.0.1",
    "--pref=network.proxy.type=0",
    `--start-url=http://moat-smoke-page.example:${port}/`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

const timer = setTimeout(() => report(null), 120_000);
const results = await reported;
clearTimeout(timer);
child.kill();
if (process.platform === "win32") spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
server.close();

if (!results) {
  console.error("FAIL  Firefox never reported back. web-ext output:\n" + log.slice(-2000));
  process.exit(1);
}
const outcome = Object.fromEntries(results);
let failed = 0;
for (const host of MUST_BLOCK) {
  const ok = outcome[host] === "blocked";
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  blocked: ${host}`);
}
for (const host of MUST_LOAD) {
  const ok = outcome[host] === "loaded";
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  loaded (control): ${host}`);
}
{
  const ok = outcome["admiral-guard"] === "blocked";
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  Admiral's anti-adblock bootstrap can't start (window.admiral)`);
}
console.log(`\n${results.length - failed}/${results.length} Firefox checks passed`);
process.exit(failed ? 1 : 0);

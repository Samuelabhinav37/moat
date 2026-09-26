// Loads dist/chrome into a real Chrome and fails if Chrome won't run it.
//
// CI's only other extension check is `web-ext lint`, which is Firefox's
// validator. Chrome-only rejections pass it green: from 0.11.31 to 0.11.37
// Chrome refused the whole extension over one `"additionalProperties": false`
// in managed_schema.json and nothing noticed. This catches that class of bug.
//
// Branded Chrome ignores --load-extension, so this uses Chrome for Testing,
// downloaded once into .cache/chrome-for-testing (or CHROME_PATH if set).
// Checks: the service worker starts, its manifest version matches
// package.json, static rulesets got enabled, and the popup, options and
// logger pages open without a script error.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, computeExecutablePath, detectBrowserPlatform, install, resolveBuildId } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "dist", "chrome");
const cacheDir = join(root, ".cache", "chrome-for-testing");
const PAGES = ["popup.html", "options.html", "logger.html"];

if (!existsSync(join(extensionDir, "manifest.json"))) {
  console.error('dist/chrome is missing. Run "npm run build" first.');
  process.exit(1);
}

async function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const platform = detectBrowserPlatform();
  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  const executablePath = computeExecutablePath({ browser: Browser.CHROME, buildId, cacheDir });
  if (!existsSync(executablePath)) {
    console.log(`Downloading Chrome for Testing ${buildId}...`);
    await install({ browser: Browser.CHROME, buildId, cacheDir });
  }
  return executablePath;
}

const failures = [];
const expectedVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const profile = mkdtempSync(join(tmpdir(), "moat-load-check-"));
// Puppeteer loads the extension over CDP during launch. When Chrome rejects
// the manifest or schema, that error escapes as an unhandled rejection rather
// than failing launch(), so report it from here.
function refused(error) {
  console.error(`Chrome load check failed: Chrome refused to load dist/chrome.
${error?.message ?? error}`);
  removeProfile();
  process.exit(1);
}

// Best effort: on Windows a Chrome that's still shutting down can hold the
// profile open, and a leftover temp dir isn't worth failing over.
function removeProfile() {
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}
process.on("unhandledRejection", refused);

const browser = await puppeteer
  .launch({
    executablePath: await chromePath(),
    headless: true,
    pipe: true,
    enableExtensions: [extensionDir],
    userDataDir: profile,
    // GitHub's Ubuntu runners block the unprivileged user namespaces Chrome's
    // sandbox needs.
    args: process.env.CI ? ["--no-sandbox"] : [],
  })
  .catch(refused);

try {
  const workerTarget = await browser
    .waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"), {
      timeout: 30_000,
    })
    .catch(() => null);
  if (!workerTarget) {
    throw new Error("No extension service worker started. Chrome most likely rejected the manifest.");
  }
  // new URL().origin is "null" for chrome-extension:// in Node.
  const extensionOrigin = workerTarget.url().match(/^chrome-extension:\/\/[^/]+/)[0];
  const worker = await workerTarget.worker();

  // The install handler enables the default rulesets a few seconds after
  // the worker starts, so poll rather than read once.
  let state;
  for (let waited = 0; waited <= 30_000; waited += 1000) {
    state = await worker.evaluate(async () => ({
      version: chrome.runtime.getManifest().version,
      rulesets: (await chrome.declarativeNetRequest.getEnabledRulesets()).length,
    }));
    if (state.rulesets > 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`Service worker up: Moat ${state.version}, ${state.rulesets} static rulesets enabled`);
  if (state.version !== expectedVersion) {
    failures.push(`manifest version ${state.version} doesn't match package.json ${expectedVersion}`);
  }
  if (state.rulesets === 0) failures.push("no static rulesets are enabled");

  for (const name of PAGES) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const response = await page.goto(`${extensionOrigin}/${name}`, { waitUntil: "load" });
    // Let the page's async first render (sendMessage round trips) finish.
    await new Promise((r) => setTimeout(r, 1500));
    if (!response?.ok()) errors.push(`HTTP ${response?.status()}`);
    console.log(`${name}: ${errors.length === 0 ? "ok" : errors.join(" | ")}`);
    for (const error of errors) failures.push(`${name}: ${error}`);
    await page.close();
  }
} catch (error) {
  failures.push(error.message);
} finally {
  await browser.close();
  removeProfile();
}

if (failures.length > 0) {
  console.error(`\nChrome load check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nChrome load check passed.");

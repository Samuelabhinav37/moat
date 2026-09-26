// Retakes the real captures that ./build.mjs turns into the store images,
// from live sites, with the current dist/chrome loaded in Chrome for
// Testing. Ads and counts change daily, so rerunning this gives different
// (still real) pictures; review them before replacing the committed ones.
//
//   npm run build && npm run store:capture   (then npm run store:build)
//
// Writes into store-assets/captures/:
//   weather-none-tall.jpg / weather-moat-tall.jpg   weather.com without / with Moat (1280x1140)
//   govuk-none-tall.jpg / govuk-moat-tall.jpg       gov.uk without / with Moat (1280x1140)
//   weather-moat.jpg, popup-weather@2x.png          weather.com with Moat, and its popup
//   weather-paused.jpg, popup-paused@2x.png         the same after pausing Moat there
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "../chrome-for-testing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const extension = join(root, "dist", "chrome");
// An optional folder argument writes somewhere else, to review before replacing.
const out = resolve(process.argv[2] ?? join(root, "store-assets", "captures"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });
if (!existsSync(join(extension, "manifest.json"))) {
  console.error('dist/chrome is missing. Run "npm run build" first.');
  process.exit(1);
}
const executablePath = await chromePath(root);
const profiles = [];

async function launch(withMoat) {
  const userDataDir = mkdtempSync(join(tmpdir(), "moat-store-capture-"));
  profiles.push(userDataDir);
  const browser = await puppeteer.launch({
    executablePath, headless: true, pipe: true, userDataDir,
    ...(withMoat ? { enableExtensions: [extension] } : {}),
  });
  if (!withMoat) return { browser };
  const worker = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"))).worker();
  await sleep(7000); // let the install finish enabling rulesets
  for (const page of await browser.pages()) if (page.url().endsWith("/welcome.html")) await page.close();
  // Picture a returning user: the popup's one-line first-run card is long gone.
  await worker.evaluate(async () => {
    const { uiState = {} } = await chrome.storage.local.get("uiState");
    await chrome.storage.local.set({ uiState: { ...uiState, hasSeenOnboarding: true } });
  });
  return { browser, worker };
}

async function open(browser, url, { height = 800, settle = 12000 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height });
  await page.setUserAgent((await browser.userAgent()).replace("HeadlessChrome", "Chrome"));
  await page.goto(url, { timeout: 60000 }).catch((e) => console.warn(`  ${url}: ${e.message}`));
  await page.bringToFront();
  await sleep(settle); // ads keep loading well after the load event
  return page;
}

const jpeg = (page, name) => page.screenshot({ path: join(out, name), type: "jpeg", quality: 88 });

async function openPopup(browser, worker) {
  await worker.evaluate(() => chrome.action.openPopup());
  const popup = await (await browser.waitForTarget((t) => t.url().includes("popup.html"))).asPage();
  await sleep(1800);
  return popup;
}

// The popup at 2x so it stays sharp when enlarged. Popup windows reject
// device-metrics emulation and a capture only covers ~600 device pixels,
// so render 200px bands at scale 2 and stack them on a canvas.
async function popupAt2x(popup, canvasPage, name) {
  const { w, h } = await popup.evaluate(() => ({ w: document.body.scrollWidth, h: document.documentElement.scrollHeight }));
  const cdp = await popup.createCDPSession();
  const bands = [];
  for (let y = 0; y < h; y += 200) {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y, width: w, height: Math.min(200, h - y), scale: 2 } });
    bands.push({ data, at: y * 2 });
  }
  const png = await canvasPage.evaluate(async (bands, width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    for (const band of bands) {
      const img = new Image();
      img.src = `data:image/png;base64,${band.data}`;
      await img.decode();
      ctx.drawImage(img, 0, band.at);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }, bands, w * 2, h * 2);
  writeFileSync(join(out, name), Buffer.from(png, "base64"));
  return { w, h };
}

try {
  // Without Moat.
  {
    const { browser } = await launch(false);
    for (const [url, name, settle] of [["https://weather.com/", "weather-none-tall.jpg", 9000], ["https://www.gov.uk/", "govuk-none-tall.jpg", 6000]]) {
      const page = await open(browser, url, { height: 1140, settle });
      await jpeg(page, name);
    }
    await browser.close();
  }
  // With Moat.
  {
    const { browser, worker } = await launch(true);
    const canvasPage = await browser.newPage();
    for (const [url, name, settle] of [["https://weather.com/", "weather-moat-tall.jpg", 12000], ["https://www.gov.uk/", "govuk-moat-tall.jpg", 6000]]) {
      const page = await open(browser, url, { height: 1140, settle });
      await jpeg(page, name);
      await page.close();
    }
    const page = await open(browser, "https://weather.com/");
    await jpeg(page, "weather-moat.jpg");
    let popup = await openPopup(browser, worker);
    const counts = await popup.evaluate(() => ["count", "count-ads", "count-trackers", "count-popups"].map((id) => document.getElementById(id)?.textContent).join(" / "));
    const size = await popupAt2x(popup, canvasPage, "popup-weather@2x.png");
    console.log(`weather.com popup: ${counts} blocked/ads/trackers/pop-ups, ${size.w}x${size.h}`);
    // Pause Moat on the site from the popup's own switch, like a user would.
    await popup.evaluate(() => document.getElementById("site-toggle").click());
    await sleep(1200);
    if (!popup.isClosed()) await popup.close();
    await page.reload().catch(() => {});
    await sleep(10000);
    await page.bringToFront();
    await jpeg(page, "weather-paused.jpg");
    popup = await openPopup(browser, worker);
    const pausedSize = await popupAt2x(popup, canvasPage, "popup-paused@2x.png");
    console.log(`paused popup: ${pausedSize.w}x${pausedSize.h}`);
    await browser.close();
  }
  console.log(`Captures written to ${out}. If the popup heights changed, update popupHeight in build.mjs.`);
} finally {
  for (const dir of profiles) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

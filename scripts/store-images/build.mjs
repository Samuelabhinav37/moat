// Builds the Chrome Web Store images in store-assets/ from the real captures
// in store-assets/captures/ (made by ./capture.mjs): five 1280x800
// screenshots, the 440x280 small promo tile and the 1400x560 marquee.
//
// The store shows screenshots at 584x365 (46% size) and promo tiles at
// 208x133, measured on the uBlock Origin Lite, AdGuard, Ghostery, Pie and
// Privacy Badger listings in September 2026. Everything here is sized to
// read at that scale: a one-line headline, one visual per frame, captions
// instead of status badges, and the name on the first frame only, since the
// store prints it right above the screenshots.
//
//   npm run store:build        (CHROME_PATH to use a specific Chrome)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { chromePath } from "../chrome-for-testing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const assets = join(root, "store-assets");
const cap = (name) => pathToFileURL(join(assets, "captures", name)).href;
const logo = readFileSync(join(root, "icons", "logo.svg"), "utf8");

// ---------- Screenshots ----------

const SHOT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; position: relative; color: #eceef0;
         font-family: "Segoe UI", system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased;
         background: radial-gradient(1000px 600px at 50% 120%, rgba(58,116,240,.22), transparent 65%), #141217; }
  .logo svg { display: block; width: 100%; height: 100%; }
  .brand { position: absolute; right: 72px; top: 58px; display: flex; align-items: center; gap: 12px; font-size: 26px; font-weight: 700; }
  .brand .logo { width: 40px; height: 40px; }
  .head { position: absolute; left: 72px; top: 50px; right: 300px; }
  h1 { margin: 0; font-size: 60px; line-height: 1.05; font-weight: 750; letter-spacing: -.025em; }
  h1 em { font-style: normal; color: #7ea6ff; }
  .sub { margin: 14px 0 0; font-size: 24px; line-height: 1.35; color: #b6b0bb; }
  .caption { position: absolute; display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .caption.off { color: #8d8793; }
  .caption.on { color: #eceef0; }
  .caption .logo { width: 26px; height: 26px; }
  .panel { position: absolute; border-radius: 14px 14px 0 0; overflow: hidden; background: #fff; box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07); }
  .bar { height: 40px; background: #e9e7ee; display: flex; align-items: center; gap: 10px; padding: 0 14px; border-bottom: 1px solid #d8d5de; position: relative; }
  .dots { display: flex; gap: 7px; } .dots i { width: 11px; height: 11px; border-radius: 50%; background: #cfccd5; display: block; }
  .url { flex: 1; background: #fff; border-radius: 999px; height: 26px; display: flex; align-items: center; padding: 0 14px; font-size: 15px; color: #4a4750; }
  .icon { width: 28px; height: 28px; border-radius: 7px; position: relative; }
  .icon.hot::after { content: ""; position: absolute; inset: -6px; border-radius: 11px; border: 3px solid #7ea6ff; }
  .view { position: relative; overflow: hidden; }
  .view img.page { position: absolute; }
  .dim { filter: saturate(.2) brightness(.5); }
  .mark { position: absolute; border: 4px solid #fa5d5d; border-radius: 10px; }
  .mark span { position: absolute; top: -17px; left: 14px; background: #fa5d5d; color: #2c1111; font-weight: 800; font-size: 16px; padding: 3px 10px; border-radius: 6px; white-space: nowrap; }
  .popup { position: absolute; border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08); }
  .card { position: absolute; left: 72px; right: 72px; top: 250px; bottom: -20px; border-radius: 18px; background: #1b191d; border: 1px solid #37343b; padding: 26px 34px; }
  .card .ctitle { display: flex; align-items: center; gap: 12px; font-size: 18px; color: #a7a1ac; font-weight: 600; margin-bottom: 8px; }
  .card .ctitle .logo { width: 26px; height: 26px; }
  .row { display: grid; grid-template-columns: 1fr 220px; align-items: center; padding: 16px 0; border-top: 1px solid #2b282f; }
  .row .host { font: 600 26px/1.2 ui-monospace, "Cascadia Mono", Consolas, monospace; }
  .row .what { font-size: 19px; color: #a7a1ac; margin-top: 4px; }
  .row .res { font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; justify-content: flex-end; }
  .row.ok .res { color: #7ddc74; }
  .row.no .res { color: #fa6d6d; }
  .row.no .host { text-decoration: line-through; text-decoration-color: #fa6d6d; text-decoration-thickness: 3px; color: #8d8793; }
`;
const brand = `<div class="brand"><span class="logo">${logo}</span>Moat</div>`;
const head = (h1, sub) => `<div class="head"><h1>${h1}</h1><p class="sub">${sub}</p></div>`;
const bar = (url, hot = false) =>
  `<div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="url">${url}</div><span class="icon logo${hot ? " hot" : ""}">${logo}</span></div>`;

// A browser panel showing a crop of a 1280px-wide page capture, starting at
// page (cx, cy) and scaled so the crop width cw fills the panel.
function panel({ left, top, width, height, url, img, cx, cy, cw, mark, dim = false, hot = false }) {
  const s = width / cw;
  const label = mark?.below ? ' style="top:auto;bottom:-38px"' : "";
  const markHtml = mark
    ? `<div class="mark" style="left:${(mark.x - cx) * s}px;top:${(mark.y - cy) * s}px;width:${mark.w * s}px;height:${mark.h * s}px"><span${label}>${mark.label}</span></div>`
    : "";
  return `<div class="panel" style="left:${left}px;top:${top}px;width:${width}px">
    ${bar(url, hot)}
    <div class="view" style="height:${height}px">
      <img class="page${dim ? " dim" : ""}" src="${img}" alt="" style="left:${-cx * s}px;top:${-cy * s}px;width:${1280 * s}px" />
      ${markHtml}
    </div></div>`;
}

const captions = (y) =>
  `<div class="caption off" style="left:72px;top:${y}px">Without Moat</div>` +
  `<div class="caption on" style="left:660px;top:${y}px"><span class="logo">${logo}</span>With Moat</div>`;

function compareFrame({ h1, sub, url, before, after, crop, mark, withBrand = false }) {
  const common = { top: 262, width: 548, height: 520, url, ...crop };
  return (withBrand ? brand : "") + head(h1, sub) + captions(218) +
    panel({ ...common, left: 72, img: cap(before), mark }) +
    panel({ ...common, left: 660, img: cap(after) });
}

// The popup hangs from the outlined toolbar icon, over the dimmed page.
function popupFrame({ h1, sub, page, popup, popupHeight }) {
  const left = 72, width = 1136, popupWidth = 360;
  const page_ = panel({ left, top: 250, width, height: 560, url: "weather.com", img: cap(page), cx: 0, cy: 0, cw: 1280, dim: true, hot: true });
  const iconCenter = left + width - 28;
  return head(h1, sub) + page_ +
    `<img class="popup" src="${cap(popup)}" alt="" style="left:${iconCenter - popupWidth + 24}px;top:300px;width:${popupWidth}px;height:${popupHeight * (popupWidth / 260)}px" />`;
}

// weather.com's real requests, from the same capture the tour uses.
function privacyFrame() {
  const rows = [
    ["weather.com", "The page itself", true],
    ["securepubads.g.doubleclick.net", "Google ad server", false],
    ["micro.rubiconproject.com", "Ad auction", false],
    ["api.lab.amplitude.com", "Behavior analytics", false],
    ["js-agent.newrelic.com", "Session monitoring", false],
  ];
  return head("Nothing leaves <em>your browser.</em>", "No account, no server, no tracking of you. Every check happens on your device.") +
    `<div class="card"><div class="ctitle"><span class="logo">${logo}</span>What happened on weather.com</div>
      ${rows.map(([host, what, ok]) => `<div class="row ${ok ? "ok" : "no"}"><div><div class="host">${host}</div><div class="what">${what}</div></div><div class="res">${ok ? "✓ Loaded" : "✕ Stopped"}</div></div>`).join("")}
    </div>`;
}

// Page coordinates in the 1280px-wide captures.
const AD = { x: 248, y: 97, w: 1015, h: 296, label: "Ad" };
const BANNER = { x: 150, y: 8, w: 640, h: 300, label: "Cookie banner", below: true };

const screenshots = {
  "1-ads": compareFrame({
    h1: "Ads disappear <em>before they load.</em>", sub: "The same weather.com page, loaded twice.", url: "weather.com",
    before: "weather-none-tall.jpg", after: "weather-moat-tall.jpg", crop: { cx: 238, cy: 60, cw: 1042 }, mark: AD, withBrand: true,
  }),
  "2-privacy": privacyFrame(),
  "3-popup": popupFrame({
    h1: "See everything <em>that was blocked.</em>", sub: "One click on the toolbar icon lists the ads, trackers and pop-ups on this page.",
    page: "weather-moat.jpg", popup: "popup-weather@2x.png", popupHeight: 507,
  }),
  "4-cookies": compareFrame({
    h1: "Cookie banners, <em>rejected for you.</em>", sub: "The “reject” button is clicked automatically, wherever the site allows it.", url: "gov.uk",
    before: "govuk-none-tall.jpg", after: "govuk-moat-tall.jpg", crop: { cx: 110, cy: 0, cw: 1060 }, mark: BANNER,
  }),
  "5-pause": popupFrame({
    h1: "Site broken? <em>Pause it there.</em>", sub: "One switch for that site. Everywhere else stays protected.",
    page: "weather-paused.jpg", popup: "popup-paused@2x.png", popupHeight: 408,
  }),
};

// ---------- Promo tile and marquee: saturated blue, almost no text ----------

const ART_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { position: relative; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
         background: linear-gradient(155deg, #3a74f0 0%, #2455d6 55%, #1b3fae 100%); }
  .logo svg { display: block; width: 100%; height: 100%; }
  .card { position: absolute; background: #fff; border-radius: 14px; box-shadow: 0 24px 50px rgba(8,20,70,.35); overflow: hidden; }
  .card .top { height: 16%; background: #eceaf2; }
  .card .line { position: absolute; height: 7%; border-radius: 99px; background: #dcd9e4; }
  .card .slot { position: absolute; border: 3px dashed #c3c8dc; border-radius: 10px; }
  .ad { position: absolute; background: #ffd23f; border-radius: 10px; box-shadow: 0 18px 30px rgba(8,20,70,.35); display: grid; place-items: center; color: #6b5200; font-weight: 800; }
  .trail { position: absolute; height: 4px; border-radius: 4px; background: rgba(255,255,255,.55); }
  .mark { position: absolute; display: flex; align-items: center; color: #fff; font-weight: 750; letter-spacing: -0.02em; }
`;
// A page card whose ad is lifting off, leaving a dashed slot, sized by u.
function pageWithAd(x, y, u, rot) {
  const w = 150 * u, h = 190 * u;
  return `
    <div class="card" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg)">
      <div class="top"></div>
      <span class="line" style="left:10%;top:24%;width:62%"></span>
      <span class="slot" style="left:10%;top:38%;width:80%;height:26%"></span>
      <span class="line" style="left:10%;top:72%;width:80%"></span>
      <span class="line" style="left:10%;top:84%;width:55%"></span>
    </div>
    <span class="trail" style="left:${x + w * 0.55}px;top:${y + h * 0.36}px;width:${34 * u}px;transform:rotate(-28deg)"></span>
    <span class="trail" style="left:${x + w * 0.62}px;top:${y + h * 0.46}px;width:${24 * u}px;transform:rotate(-28deg)"></span>
    <div class="ad" style="left:${x + w * 0.62}px;top:${y - h * 0.02}px;width:${w * 0.7}px;height:${h * 0.24}px;transform:rotate(${rot + 14}deg);font-size:${16 * u}px">AD</div>`;
}
const wordmark = (x, y, size, font) =>
  `<div class="mark" style="left:${x}px;top:${y}px;gap:${size * 0.35}px;font-size:${font}px"><span class="logo" style="width:${size}px;height:${size}px">${logo}</span>Moat</div>`;

const art = {
  "promo-tile-440x280": { width: 440, height: 280, body: `${pageWithAd(262, 62, 0.8, -6)}${wordmark(30, 110, 52, 36)}` },
  "marquee-1400x560": { width: 1400, height: 560, body: `${wordmark(120, 214, 120, 92)}${pageWithAd(660, 170, 1.35, -8)}${pageWithAd(1030, 110, 1.6, 5)}` },
};

// ---------- Render ----------

const work = mkdtempSync(join(tmpdir(), "moat-store-"));
const jobs = [
  ...Object.entries(screenshots).map(([name, body]) => ({ name, width: 1280, height: 800, html: `<style>${SHOT_CSS}</style>${body}` })),
  ...Object.entries(art).map(([name, a]) => ({ name, width: a.width, height: a.height, html: `<style>${ART_CSS} body{width:${a.width}px;height:${a.height}px}</style>${a.body}` })),
];
const browser = await puppeteer.launch({ executablePath: await chromePath(root), headless: true, args: ["--allow-file-access-from-files"] });
try {
  const page = await browser.newPage();
  for (const job of jobs) {
    const file = join(work, `${job.name}.html`);
    writeFileSync(file, `<!doctype html><meta charset="utf-8">${job.html}`);
    await page.setViewport({ width: job.width, height: job.height });
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.screenshot({ path: join(assets, `${job.name}.png`) });
    console.log(`store-assets/${job.name}.png  ${job.width}x${job.height}`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

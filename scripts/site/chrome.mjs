// The parts every page under samuelabhinav.com/moat/ shares: the head
// (font, styles, icon), the local nav and the footer. scripts/site-build.mjs
// puts them into each page, so a link changes in one place.
export const ORIGIN = "https://samuelabhinav.com";
export const BASE = "/moat/";
export const REPO = "https://github.com/Samuelabhinav37/moat";
// TODO(launch): the Chrome Web Store listing URL isn't known yet. Until it is,
// every data-store link points at GitHub releases.
export const STORE = `${REPO}/releases`;

export const PAGES = {
  overview: { href: BASE, label: "Overview" },
  "whats-new": { href: `${BASE}whats-new/`, label: "What's New" },
  privacy: { href: `${BASE}privacy/`, label: "Privacy" },
  support: { href: `${BASE}support/`, label: "Support" },
};

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x=".5" y=".5" width="31" height="31" rx="7" fill="#030307" stroke="rgba(255,255,255,.18)"/><line x1="24" y1="8" x2="16" y2="16" stroke="rgba(255,255,255,.55)" stroke-width="2"/><line x1="16" y1="16" x2="9" y2="25" stroke="rgba(255,255,255,.55)" stroke-width="2"/><line x1="16" y1="16" x2="5.5" y2="11" stroke="rgba(255,255,255,.55)" stroke-width="2"/><circle cx="24" cy="8" r="4" fill="#fff"/><circle cx="16" cy="16" r="2.8" fill="rgba(255,255,255,.85)"/><circle cx="9" cy="25" r="2.2" fill="rgba(255,255,255,.7)"/><circle cx="5.5" cy="11" r="2" fill="rgba(255,255,255,.62)"/></svg>`;
const CHEVRON = `<svg viewBox="0 0 14 8" aria-hidden="true"><path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CRUMB = `<svg viewBox="0 0 7 12" aria-hidden="true"><path d="M1 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23030307'/%3E%3Cline x1='24' y1='8' x2='16' y2='16' stroke='rgba(255,255,255,.55)' stroke-width='2'/%3E%3Cline x1='16' y1='16' x2='9' y2='25' stroke='rgba(255,255,255,.55)' stroke-width='2'/%3E%3Cline x1='16' y1='16' x2='5.5' y2='11' stroke='rgba(255,255,255,.55)' stroke-width='2'/%3E%3Ccircle cx='24' cy='8' r='4' fill='%23fff'/%3E%3Ccircle cx='16' cy='16' r='2.8' fill='rgba(255,255,255,.85)'/%3E%3Ccircle cx='9' cy='25' r='2.2' fill='rgba(255,255,255,.7)'/%3E%3Ccircle cx='5.5' cy='11' r='2' fill='rgba(255,255,255,.62)'/%3E%3C/svg%3E`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The shared <head> lines. `path` is the page's path under the origin. */
export function head({ title, description, path, image = `${BASE}og.png` }) {
  const url = ORIGIN + path;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Moat">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN + image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#000000">
<link rel="icon" href="${FAVICON}">
<link rel="preload" href="${BASE}fonts/inter-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BASE}css/chrome.css">
<script src="${BASE}js/boot.js"></script>`;
}

/** The local nav. `active` is a key of PAGES, or "" for none. */
export function nav(active) {
  const links = Object.entries(PAGES)
    .map(([key, p]) => `<a href="${p.href}"${key === active ? ' aria-current="page"' : ""}>${p.label}</a>`)
    .join("");
  return `<a class="skip" href="#main">Skip to content</a>
<nav class="nav" aria-label="Moat">
  <div class="wrap">
    <a class="logo" href="${BASE}">${LOGO}Moat</a>
    <div class="nav-links">${links}</div>
    <details class="nav-menu"><summary aria-label="Moat pages">${CHEVRON}</summary><div class="sheet">${links}</div></details>
    <a class="btn btn-blue btn-sm" data-store href="${STORE}">Add to Chrome</a>
  </div>
</nav>`;
}

/** The footer: breadcrumb, columns, then the legal line. */
export function footer(active) {
  const here = active && active !== "overview" ? PAGES[active] : null;
  const crumbs = [`<a href="${ORIGIN}/">Samuel Abhinav</a>`, here ? `<a href="${BASE}">Moat</a>` : `<span aria-current="page">Moat</span>`];
  if (here) crumbs.push(`<span aria-current="page">${here.label}</span>`);
  return `<div class="wrap">
<footer class="site">
  <nav class="crumbs" aria-label="Breadcrumb">${crumbs.join(CRUMB)}</nav>
  <div class="foot-cols" role="navigation" aria-label="Footer">
    <div><h4>Moat</h4><a href="${BASE}">Overview</a><a href="${BASE}whats-new/">What's New</a><a data-store href="${STORE}">Add to Chrome</a></div>
    <div><h4>Help</h4><a href="${BASE}support/">Support</a><a href="${BASE}support/#report">Report a problem</a><a href="${BASE}support/#faq">Questions</a></div>
    <div><h4>Policies</h4><a href="${BASE}privacy/">Privacy policy</a><a href="${BASE}licenses/">Licenses</a></div>
    <div><h4>Source</h4><a href="${REPO}">GitHub</a><a href="${REPO}/releases">Releases</a><a href="${REPO}#install--build">Build from source</a></div>
  </div>
  <div class="foot-bottom"><span>Copyright © 2026 Samuel Abhinav. Moat is free and open source.</span><nav aria-label="Legal"><a href="${BASE}privacy/">Privacy</a><a href="${BASE}licenses/">Licenses</a><a href="${ORIGIN}/">samuelabhinav.com</a></nav></div>
</footer>
</div>`;
}

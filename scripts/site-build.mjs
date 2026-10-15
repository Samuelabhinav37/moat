// Builds Moat's website, served at samuelabhinav.com/moat/ by the moat-site
// Worker (site-worker/). Hand-written pages live in site/ and mark where the
// shared parts go (<!--@head-->, <!--@nav:key-->, <!--@footer:key-->,
// <!--@faq-->). What's New, Privacy and Licenses are generated from
// CHANGELOG.md, PRIVACY.md and NOTICE.md through the same scripts/docs/
// renderer as the extension's own pages, so the site can't disagree with them.
//
//   npm run site:build      write site-dist/
//
// The build fails if any page links to a /moat/ path that doesn't exist.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { buildDocs } from "./docs/buildDocs.mjs";
import { BASE, ORIGIN, footer, head, nav } from "./site/chrome.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "site");
const DIST = join(root, "site-dist");
const OUT = join(DIST, "moat");
const read = (p) => readFileSync(p, "utf8");
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };

// Hand-written pages: the head text for each, keyed by path under site/.
const PAGES = {
  "index.html": { title: "Moat", description: "Moat is a free, open-source ad blocker for Chrome. It stops ads, trackers and hijacked pop-ups before they load. No account, no telemetry, and blocking runs in your browser.", path: BASE },
  "support/index.html": { title: "Moat Support", description: "Fix a site that looks wrong, report a problem, or find an answer about Moat.", path: `${BASE}support/` },
  "404.html": { title: "Page not found · Moat", description: "This page isn't part of Moat's site.", path: `${BASE}404.html` },
};

function fill(html, meta) {
  const faq = read(join(SRC, "_parts", "faq.html"));
  return html
    .replace("<!--@head-->", head(meta))
    .replace(/<!--@nav:([\w-]*)-->/, (_, k) => nav(k))
    .replace(/<!--@footer:([\w-]*)-->/, (_, k) => footer(k))
    .replace("<!--@faq-->", faq);
}

// The generated document pages: the extension's page, with the site's head,
// nav and footer in place of the extension's own bar.
const DOCS = {
  privacy: { file: "privacy.html", out: "privacy/index.html", title: "Privacy policy · Moat", description: "What Moat does with your data, in plain words. Short version first." },
  "whats-new": { file: "changelog.html", out: "whats-new/index.html", title: "What's New in Moat", description: "What changed in each version of Moat." },
  licenses: { file: "licenses.html", out: "licenses/index.html", title: "Licenses · Moat", description: "Moat's own license, and every list and library it ships with." },
};
const SITE_FONT_NOTE = `<div class="prose note"><p>This website uses the <a href="https://github.com/rsms/inter">Inter</a> typeface, under the SIL Open Font License 1.1.</p></div>`;

function docPage(key, html) {
  const d = DOCS[key];
  const path = `${BASE}${d.out.replace(/index\.html$/, "")}`;
  let out = html
    .replace(/<html lang="en">/, '<html lang="en" data-theme="dark">')
    .replace(/<head>[\s\S]*?<\/head>/, `<head>\n${head({ title: d.title, description: d.description, path })}\n<link rel="stylesheet" href="${BASE}css/docs.css">\n</head>`)
    .replace(/<a class="skip"[^>]*>[^<]*<\/a>\s*<header class="bar moat-header">[\s\S]*?<\/header>/, nav(key))
    .replace(/<script src="docs\.js"><\/script>/, `${footer(key)}\n<script src="${BASE}js/docs.js" defer></script>`)
    .replace(/href="privacy\.html"/g, `href="${BASE}privacy/"`)
    .replace(/href="changelog\.html"/g, `href="${BASE}whats-new/"`)
    .replace(/href="licenses\.html"/g, `href="${BASE}licenses/"`)
    .replace(/<a href="logger\.html"[\s\S]*?<\/a>/g, "")
    .replace(/href="options\.html[^"]*"/g, `href="${BASE}"`);
  // The privacy page's version line would go stale between releases.
  if (key === "privacy") out = out.replace(/<span>·<\/span><span>Moat [\d.]+<\/span>/, "").replace(/<span>Moat [\d.]+<\/span>/, "");
  if (key === "licenses") out = out.replace(/<\/main>/, `${SITE_FONT_NOTE}</main>`);
  if (key === "whats-new") out = out.replace("<h1>Changelog</h1>", "<h1>What's New</h1>");
  for (const [k, re] of [["head", /<!--@|docs\.js"|theme-boot/], ["header", /moat-header/]]) {
    if (re.test(out.replace(`${BASE}js/docs.js`, ""))) throw new Error(`site-build: ${key} page still has the extension's ${k}`);
  }
  return `<!-- Built by scripts/site-build.mjs from ${d.file === "changelog.html" ? "CHANGELOG.md" : d.file === "privacy.html" ? "PRIVACY.md" : "NOTICE.md"}. Don't edit by hand. -->\n${out}`;
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

export function buildSite() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  // Everything in site/ except the shared parts and the old GitHub Pages privacy copy.
  cpSync(SRC, OUT, { recursive: true, filter: (p) => { const r = relative(SRC, p).split(sep)[0]; return r !== "_parts" && r !== "privacy"; } });

  for (const [rel, meta] of Object.entries(PAGES)) {
    const p = join(OUT, rel);
    write(p, fill(read(p), meta));
  }

  const tmp = mkdtempSync(join(tmpdir(), "moat-site-"));
  try {
    buildDocs(root, tmp);
    for (const [key, d] of Object.entries(DOCS)) write(join(OUT, d.out), docPage(key, read(join(tmp, d.file))));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  write(join(OUT, "css", "docs.css"), ["src/ui/theme.css", "src/ui/components.css", "src/docs/doc.css", "site/_parts/docs-site.css"].map((p) => read(join(root, p))).join("\n"));
  write(join(OUT, "js", "docs.js"), transformSync(read(join(root, "src", "docs", "docs.ts")), { loader: "ts", format: "esm", minify: true }).code);

  const pages = [BASE, ...Object.values(PAGES).map((m) => m.path).filter((p) => !p.endsWith("404.html") && p !== BASE), ...Object.values(DOCS).map((d) => `${BASE}${d.out.replace(/index\.html$/, "")}`)];
  write(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
  cpSync(join(root, "site-worker", "_headers"), join(DIST, "_headers"));

  // Every /moat/ link and asset on every page must exist in the build.
  const missing = [];
  for (const file of walk(OUT).filter((p) => p.endsWith(".html"))) {
    for (const [, url] of read(file).matchAll(/(?:href|src|poster)="(\/moat\/[^"#?]*)/g)) {
      const target = join(DIST, ...url.split("/").filter(Boolean));
      const ok = url.endsWith("/") ? existsSync(join(target, "index.html")) : existsSync(target) || existsSync(join(target, "index.html"));
      if (!ok) missing.push(`${relative(DIST, file)} -> ${url}`);
    }
  }
  if (missing.length) throw new Error(`site-build: broken links\n  ${missing.join("\n  ")}`);
  return pages;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = buildSite();
  console.log(`Wrote site-dist/ (${pages.length} pages)`);
}

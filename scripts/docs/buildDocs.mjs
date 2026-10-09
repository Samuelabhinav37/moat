// Builds Moat's document pages (Privacy policy, Changelog, Licenses) from the
// repo's own PRIVACY.md, CHANGELOG.md and NOTICE.md, so the pages inside the
// extension can never say something the files don't. scripts/build.mjs calls
// buildDocs() for every build. The pages load no inline script (extension
// pages forbid it): theme-boot.js sets the theme and docs.js does the rest.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { buildPrivacyBody, PRIVACY_TOC } from "./privacyPage.mjs";

export function buildDocs(REPO, outDir) {
const write = (name, html) => writeFileSync(join(outDir, name), html);
const md = (p) => readFileSync(join(REPO, p), "utf8").replace(/\r/g, "");
// Dates come from git when it is there; a build from a source zip simply has none.
const git = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }); } catch { return ""; } };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${/^https?:/.test(u) ? u : `https://github.com/Samuelabhinav37/moat/blob/master/${u}`}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/ -- /g, " – ");
}
// Small Markdown renderer: headings, paragraphs, nested bullet and numbered lists, code blocks, rules.
function render(src, { h2Class = "" } = {}) {
  const lines = src.split("\n"); let html = ""; const toc = []; let para = []; const stack = [];
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const closeLists = (depth = -1) => { while (stack.length && stack[stack.length - 1].indent > depth) { html += `</li></${stack.pop().tag}>`; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { flush(); closeLists(); let code = ""; while (++i < lines.length && !/^```/.test(lines[i])) code += lines[i] + "\n"; html += `<pre><code>${esc(code)}</code></pre>`; continue; }
    const h = l.match(/^(#{2,4}) (.+)/);
    if (h) { flush(); closeLists(); const lvl = h[1].length; const t = inline(h[2]); const id = slug(h[2]); if (lvl === 2) toc.push([id, t]); html += `<h${lvl} id="${id}" class="${lvl === 2 ? h2Class : ""}">${t}</h${lvl}>`; continue; }
    if (/^---+$/.test(l.trim())) { flush(); closeLists(); html += "<hr>"; continue; }
    const li = l.match(/^(\s*)([-*]|\d+\.) (.+)/);
    if (li) {
      flush(); const indent = li[1].length; const tag = /\d/.test(li[2]) ? "ol" : "ul";
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) { html += `<${tag}><li>`; stack.push({ indent, tag }); }
      else { closeLists(indent); const t2 = stack[stack.length - 1]; if (t2 && t2.indent === indent) html += "</li><li>"; else { html += `<${tag}><li>`; stack.push({ indent, tag }); } }
      html += inline(li[3]); continue;
    }
    if (!l.trim()) { flush(); if (!(lines[i + 1] && /^\s*([-*]|\d+\.) /.test(lines[i + 1]) && stack.length)) closeLists(); continue; }
    if (stack.length && /^\s+\S/.test(l)) { html += " " + inline(l.trim()); continue; }
    closeLists(); para.push(l.trim());
  }
  flush(); closeLists(); return { html, toc };
}

const LOGO = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#030307"/><line x1="24" y1="8" x2="16" y2="16" stroke="rgba(255,255,255,.55)" stroke-width="2"/><line x1="16" y1="16" x2="9" y2="25" stroke="rgba(255,255,255,.55)" stroke-width="2"/><line x1="16" y1="16" x2="5.5" y2="11" stroke="rgba(255,255,255,.55)" stroke-width="2"/><circle cx="24" cy="8" r="4" fill="#fff"/><circle cx="16" cy="16" r="2.8" fill="rgba(255,255,255,.85)"/><circle cx="9" cy="25" r="2.2" fill="rgba(255,255,255,.7)"/><circle cx="5.5" cy="11" r="2" fill="rgba(255,255,255,.62)"/></svg>`;
const ICON = {
  shield: '<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6z"/>',
  doc: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5"/>',
  scale: '<path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 006 0zM18 8l-3 6a3 3 0 006 0z"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  box: '<path d="M4 7.5l8-4 8 4v9l-8 4-8-4z"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/>',
  upload: '<path d="M12 20V9M7 13l5-5 5 5M5 4h14"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
};
const ic = (k, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const NAV = [["privacy.html", "privacy", "Privacy policy", "shield"], ["changelog.html", "changelog", "Changelog", "doc"], ["licenses.html", "licenses", "Licenses", "scale"], ["logger.html", "diagnostics", "Diagnostics", "pulse"]];

function page({ id, title, lead, meta, body, toc = [] }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Moat</title><link rel="stylesheet" href="components.css"><link rel="stylesheet" href="doc.css"><script src="theme-boot.js"></script></head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar moat-header"><a class="back" href="options.html#about">${ic("back", 16)}Settings</a><a class="moat-brand" href="options.html#about" aria-label="Moat settings">${LOGO}<span>Moat</span></a><nav class="docnav" aria-label="Documents">${NAV.map(([href, k, l, i]) => `<a href="${href}" ${k === id ? 'aria-current="page"' : ""}>${ic(i, 16)}<span>${l}</span></a>`).join("")}<a href="https://github.com/Samuelabhinav37/moat" target="_blank" rel="noopener">${ic("code", 16)}<span>Source code</span>${ic("ext", 13)}<span class="sr">(opens GitHub)</span></a></nav></header>
<div class="wrap ${toc.length ? "has-toc" : ""}">
${toc.length ? `<aside class="toc"><div class="toc-h">On this page</div>${toc.map(([tid, t]) => `<a href="#${tid}" data-toc="${tid}">${t}</a>`).join("")}</aside>` : ""}
<main id="main" tabindex="-1"><div class="head"><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}${meta ? `<div class="meta">${meta}</div>` : ""}</div><div class="lang-note" id="lang-note" data-doc="${id}" role="note" hidden></div>${toc.length ? `<label class="toc-m"><span>On this page</span><select data-tocm>${toc.map(([tid, t]) => `<option value="${tid}">${t}</option>`).join("")}</select></label>` : ""}${body}</main></div>
<script src="docs.js"></script></body></html>`;
}

// ---------- Privacy ----------
{
  const src = md("PRIVACY.md").replace(/^# .*\n/, "");
  const updated = git(["log", "-1", "--format=%cs", "--", "PRIVACY.md"]).trim();
  const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
  const body = buildPrivacyBody({ fullHtml: render(src).html, version, updated });
  const when = updated ? new Date(updated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  write("privacy.html", page({ id: "privacy", title: "Privacy policy", lead: "What Moat does with your data, in plain words. Short version first.", meta: `${when ? `<span>Updated ${when}</span><span>·</span>` : ""}<span>Moat ${version}</span>`, body, toc: PRIVACY_TOC }));
}

// ---------- Changelog ----------
{
  // Dates come from the version's commit. Headings come from the entry itself:
  // its first bold lead ("Pages no longer jump ..."), which then isn't repeated
  // in the bullet. Commit subjects ("Procedural cosmetics: ...") are for developers.
  const log = git(["log", "--format=%cs|%s", "-400"]).split("\n");
  const info = {}; for (const l of log) { const m = l.match(/^(\S+)\|(.*)\((0\.\d+\.\d+)\)\s*$/); if (m && !info[m[3]]) info[m[3]] = { date: m[1] }; }
  const src = md("CHANGELOG.md"); const parts = src.split(/\n## /).slice(1, 21);
  const TAG = { fixed: "fix", added: "new", changed: "chg", security: "sec", removed: "rem", performance: "perf" };
  const entries = parts.map((raw) => {
    const lead = raw.match(/\*\*(.+?)\*\*[ \t]*/);
    const p = lead ? raw.replace(lead[0], "") : raw;
    const ver = p.split("\n")[0].trim(); const i = { ...info[ver], title: lead ? lead[1].replace(/[.:]$/, "") : "" };
    const secs = p.split(/\n### /).slice(1).map((s) => { const name = s.split("\n")[0].trim(); const kind = Object.keys(TAG).find((k) => name.toLowerCase().startsWith(k)) || "changed"; return { name, kind, html: render(s.slice(s.indexOf("\n"))).html }; });
    const kinds = [...new Set(secs.map((s) => s.kind))];
    return `<article class="rel" id="v${ver.replace(/\./g, "-")}" data-kinds="${kinds.join(" ")}"><div class="rel-side"><span class="ver">${ver}</span>${i.date ? `<time datetime="${i.date}">${new Date(i.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time>` : ""}</div>
      <div class="rel-body">${i.title ? `<h2>${esc(i.title)}</h2>` : `<h2>Version ${ver}</h2>`}${secs.map((s) => `<div class="part"><span class="tag ${TAG[s.kind]}">${esc(s.name.replace(/\s*\(.*\)/, ""))}</span><div class="prose">${s.html}</div></div>`).join("")}</div></article>`;
  });
  const filters = [["all", "All"], ["fixed", "Fixed"], ["added", "Added"], ["changed", "Changed"], ["security", "Security"]];
  const body = `<div class="tools"><div class="seg" role="tablist">${filters.map(([k, l], n) => `<button role="tab" data-f="${k}" aria-selected="${n === 0}">${l}</button>`).join("")}</div><label class="find">${ic("search", 16)}<input id="q" type="search" placeholder="Search changes" aria-label="Search changes"></label></div>
    <div class="timeline" id="tl">${entries.join("")}</div><p class="empty" id="none" hidden>No changes match.</p>
    <p class="more"><a href="https://github.com/Samuelabhinav37/moat/blob/master/CHANGELOG.md" target="_blank" rel="noopener">Older versions on GitHub ${ic("ext", 12)}</a></p>`;
  write("changelog.html", page({ id: "changelog", title: "Changelog", lead: "What changed in each version of Moat.", meta: `<span>Latest: <b>${JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version}</b></span><span>·</span><span>${parts.length} recent versions</span>`, body }));
}

// ---------- Licenses ----------
{
  const src = md("NOTICE.md"); const intro = src.split("\n---\n")[0].replace(/^# .*\n/, "");
  const items = src.split(/\n## /).slice(1).map((s) => { const head = s.split("\n")[0]; const [name, lic] = head.split(/ -- /); const text = s.slice(s.indexOf("\n")).trim(); const srcLink = (text.match(/\[[^\]]+\]\((https?:[^)]+)\)/) || [])[1]; return { name: name.replace(/`/g, "").trim(), lic: (lic || "").trim(), text, srcLink }; });
  const kind = (l) => (/no stated/i.test(l) ? "warn" : /NC/.test(l) ? "nc" : /GPL/.test(l) ? "gpl" : /MIT|MPL|CC0|Apache|BSD/.test(l) ? "perm" : "other");
  const body = `<section class="own"><div><h2>Moat itself</h2><p>Free software under the <b>GNU General Public License v3.0</b>. You can use, study, share and change it.</p></div><a class="btn" href="https://github.com/Samuelabhinav37/moat/blob/master/LICENSE" target="_blank" rel="noopener">Read GPL-3.0 ${ic("ext", 13)}</a></section>
    <h2 class="sub">Bundled with Moat <span class="count">${items.length}</span></h2>
    <div class="lic-list">${items.map((it) => `<details class="lic"><summary><span class="nm">${inline(it.name)}</span><span class="badge ${kind(it.lic)}">${esc(it.lic.replace(/\(.*\)/, "").trim() || "See notes")}</span>${it.srcLink ? `<a class="src" href="${it.srcLink}" target="_blank" rel="noopener">Source ${ic("ext", 12)}</a>` : "<span></span>"}<span class="chev">${ic("back", 16)}</span></summary><div class="prose">${render(it.text).html}</div></details>`).join("")}</div>
    <div class="prose note">${render(intro).html}</div>`;
  write("licenses.html", page({ id: "licenses", title: "Licenses", lead: "Moat's own license, and every list and library it ships with.", meta: `<span>From NOTICE.md, shipped inside every Moat package</span>`, body }));
}

}

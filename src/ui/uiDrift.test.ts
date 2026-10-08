/// <reference types="node" />
// Moat's shared pieces (components.css) are defined once. This fails when a
// page grows its own copy again: a second switch, its own brand header, or
// a page that forgets the shared stylesheet. Six headers and two switch
// colours were how the pages drifted apart before 0.11.234.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGES = [
  "src/popup/popup.html",
  "src/options/options.html",
  "src/report/report.html",
  "src/logger/logger.html",
  "src/welcome/welcome.html",
  "src/warning/warning.html",
  "src/blocked/blocked.html",
];
/** Pages with Moat's name at the top. The two block pages are browser-style
 * interstitials and lead with what happened instead. */
const BRANDED = ["src/popup/popup.html", "src/options/options.html", "src/report/report.html", "src/logger/logger.html", "src/welcome/welcome.html"];

const read = (path: string) => readFileSync(path, "utf8");
const styles = (html: string) => Array.from(html.matchAll(/<style>([\s\S]*?)<\/style>/g), (m) => m[1]!).join("\n");
/** A page's own stylesheet file, where it has one instead of a <style> block. */
const OWN_CSS: Record<string, string> = { "src/options/options.html": "src/options/options.css" };
const ownStyles = [
  ...PAGES.map((p) => [p, styles(read(p)) + (OWN_CSS[p] ? read(OWN_CSS[p]) : "")] as const),
  ["src/ui/theme.css", read("src/ui/theme.css")] as const,
  ["src/docs/doc.css", read("src/docs/doc.css")] as const,
];

describe("shared components stay shared", () => {
  it("loads components.css right after theme.css on every page", () => {
    for (const page of PAGES) {
      expect(read(page), page).toMatch(/<link rel="stylesheet" href="theme\.css" \/>\s*<link rel="stylesheet" href="components\.css" \/>/);
    }
    expect(read("scripts/docs/buildDocs.mjs")).toContain('<link rel="stylesheet" href="components.css">');
  });

  it("defines the switch only in components.css", () => {
    // A page may place a switch (margins, alignment) but not draw one.
    const drawing = /(^|[\s,}])\.switch(\s+\.(track|thumb)|\s+input[^{]*\.(track|thumb))?\s*\{[^}]*\b(width|height|background|border-radius|inset)\s*:/m;
    for (const [file, css] of ownStyles) {
      const hits = css.split("}").filter((rule) => drawing.test(`${rule}}`) && !/setting-subrow|override-row|td:has/.test(rule));
      expect(hits, file).toEqual([]);
    }
  });

  it("gives every branded page the shared header and brand", () => {
    for (const page of BRANDED) {
      const html = read(page);
      expect(html, page).toMatch(/<header class="[^"]*\bmoat-header\b/);
      expect(html, page).toMatch(/class="moat-brand\b/);
    }
    const docs = read("scripts/docs/buildDocs.mjs");
    expect(docs).toContain('class="bar moat-header"');
    expect(docs).toContain('class="moat-brand"');
  });

  it("draws every 24px UI icon at one stroke width (2.4 is kept for checkmarks)", () => {
    for (const file of [...PAGES, "scripts/docs/buildDocs.mjs"]) {
      const odd = Array.from(read(file).matchAll(/<svg\b[^>]*viewBox="0 0 24 24"[^>]*>/g), (m) => m[0])
        .map((tag) => /stroke-width="([\d.]+)"/.exec(tag)?.[1])
        .filter((width) => width !== undefined && width !== "1.75" && width !== "2.4");
      expect(odd, file).toEqual([]);
    }
  });

  it("leaves no page with its own .brand rules", () => {
    for (const [file, css] of ownStyles) {
      expect(css, file).not.toMatch(/(^|[\s,}])\.brand\s*[{>:]|(^|[\s,}])\.brand\s+(img|svg|span|a|\.mark)\b/m);
    }
  });
});

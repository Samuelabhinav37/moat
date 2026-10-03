/// <reference types="node" />
// The Settings colour tiles (options.html): every screen in the sidebar has
// one, and each keeps its white glyph readable. WCAG 1.4.11 asks 3:1 for
// icons; these stay at 5:1 or more.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "../shared/colorContrast";
import { PAGE_KEYS } from "./dashboard";

const page = readFileSync("src/options/options.html", "utf8");
// Only the stylesheet: scanning the whole page with the pattern below made
// this test slow enough to time out in a busy full run.
const html = page.slice(page.indexOf("<style>"), page.indexOf("</style>"));

/** Every `--tile: #xxxxxx` and the selectors it's set on. */
function tiles(): { selectors: string; color: string }[] {
  return Array.from(html.matchAll(/([^{}]+)\{\s*--tile:\s*(#[0-9a-fA-F]{6});\s*\}/g), (m) => ({ selectors: m[1]!.trim(), color: m[2]! }));
}

describe("settings colour tiles", () => {
  it("gives every sidebar screen a tile", () => {
    const all = tiles().map((t) => t.selectors).join(",");
    for (const key of PAGE_KEYS) expect(all, key).toContain(`.dash-nav a[data-page="${key}"]`);
  });

  it("keeps the white glyph at 5:1 or more on every tile", () => {
    const white = parseColor("#ffffff")!;
    for (const { selectors, color } of tiles()) {
      expect(contrastRatio(parseColor(color)!, white), selectors).toBeGreaterThanOrEqual(5);
    }
  });

  it("uses a different colour for each screen", () => {
    const colors = tiles().map((t) => t.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });
});

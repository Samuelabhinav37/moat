/// <reference types="node" />
// The Settings sidebar tiles (options.html): every screen sits on the same
// neutral tile and only the current one turns blue. Its white glyph stays
// readable: WCAG 1.4.11 asks 3:1 for icons; this stays at 5:1 or more.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "../shared/colorContrast";

const page = readFileSync("src/options/options.html", "utf8");
// Only the stylesheet: scanning the whole page made this test slow enough
// to time out in a busy full run.
const html = page.slice(page.indexOf("<style>"), page.indexOf("</style>"));

describe("settings sidebar tiles", () => {
  it("keeps the white glyph at 5:1 or more on the current screen's tile", () => {
    const current = /--tile-current:\s*(#[0-9a-fA-F]{6});/.exec(html)?.[1];
    expect(current).toBeDefined();
    expect(contrastRatio(parseColor(current!)!, parseColor("#ffffff")!)).toBeGreaterThanOrEqual(5);
  });

  it("gives no screen a colour of its own", () => {
    expect(html).not.toMatch(/\.dash-nav a\[data-page="[a-z]+"\]\s*\{\s*--tile:/);
  });
});

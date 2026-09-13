// @vitest-environment jsdom
//
// Renders the REAL options.html + options.ts against a mocked
// webextension-polyfill, then checks for the two bug classes this codebase
// has actually shipped on this page: a crash during render (the data-i18n/
// badge-span bug fixed in v0.11.83) and invisible text (the color-token
// mismatch fixed in v0.11.89, on the popup side of the same feature). A
// deliberate, narrow exception to options.ts's "not unit-tested, it imports
// webextension-polyfill directly" convention -- see popup.render.test.ts's
// header for the same reasoning.
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBrowser } from "../shared/mockExtensionBrowser";
import { loadPageFixture } from "../shared/loadPageFixture";
import { findInvisibleText } from "../shared/findInvisibleText";

const OPTIONS_HTML = join(__dirname, "options.html");
const THEME_CSS = join(__dirname, "..", "ui", "theme.css");

let caughtErrors: unknown[] = [];

beforeEach(() => {
  vi.resetModules();
  caughtErrors = [];
  window.addEventListener("error", (e) => caughtErrors.push(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => caughtErrors.push(e.reason));
});

afterEach(() => {
  vi.doUnmock("webextension-polyfill");
});

async function renderOptions(): Promise<void> {
  const { browser } = createMockBrowser({ hostname: "example.com" });
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
  await import("./options");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Clicks every rail tab so each panel's content actually renders/populates
 * -- render() only fully computes the tab that's initially active plus
 * whatever's pre-rendered; the others need their own click to load (e.g.
 * Trackers' company breakdown is fetched on click, not on initial render). */
async function visitEveryTab(): Promise<void> {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".rail-item")) {
    button.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
  for (const details of document.querySelectorAll("details")) (details as HTMLDetailsElement).open = true;
  // Open the Protection tab's drawer too -- click the first toggleable row.
  document.querySelector<HTMLElement>(".rail-item[data-tab='protection']")?.click();
  const firstRow = document.querySelector<HTMLElement>("#protection-groups .protection-row");
  firstRow?.click();
}

describe("options.html render", () => {
  // A generic "did anything throw" check on top-level event listeners is
  // unreliable here -- render() is fire-and-forget (`void render()`), and
  // whether a rejection from it surfaces via window's "unhandledrejection"
  // before vitest's own process-level handler intercepts it first is a race,
  // confirmed directly: reintroducing the real v0.11.83 crash still exited 0
  // with this alone. Checking that render() actually finished populating
  // real content is what caught that bug by hand in the first place, and
  // doesn't depend on error-event timing at all -- if render() throws
  // partway through (exactly what v0.11.83 did, on its very first line),
  // this is empty/unpopulated instead.
  it("actually finishes populating the page (catches a crash partway through render())", async () => {
    await renderOptions();
    expect(document.getElementById("version-text")?.textContent).toBe("v0.0.0-test");
    expect(document.getElementById("protection-groups")?.children.length).toBeGreaterThan(0);
    expect(caughtErrors).toEqual([]);
  });

  it("has no practically-invisible text across every tab (the v0.11.89 bug class)", async () => {
    await renderOptions();
    await visitEveryTab();
    const findings = findInvisibleText(document.body);
    expect(findings).toEqual([]);
  });
});

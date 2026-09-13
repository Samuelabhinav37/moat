// @vitest-environment jsdom
//
// Renders the REAL popup.html + popup.ts (not a hand-copied approximation)
// against a mocked webextension-polyfill, then checks for exactly the two
// bug classes v0.11.89 shipped: a crash during render, and text that's
// practically invisible against its own background. This is a deliberate,
// narrow exception to popup.ts's own "not unit-tested, it imports
// webextension-polyfill directly" convention -- that convention is about
// full behavioral testing, not about leaving this class of bug with zero
// automated coverage. See findInvisibleText.ts's own header for why.
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBrowser } from "../shared/mockExtensionBrowser";
import { loadPageFixture } from "../shared/loadPageFixture";
import { findInvisibleText } from "../shared/findInvisibleText";

const POPUP_HTML = join(__dirname, "popup.html");
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

async function renderPopup(): Promise<void> {
  const { browser } = createMockBrowser({ hostname: "nytimes.com" });
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(POPUP_HTML, [THEME_CSS]);
  await import("./popup");
  // Let the async render()/renderUiNotices()/renderSiteOverrides() chains
  // (each a real network of awaited sendMessage/storage calls) settle.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("popup.html render", () => {
  it("renders without throwing or an unhandled rejection", async () => {
    await renderPopup();
    expect(caughtErrors).toEqual([]);
  });

  it("has no practically-invisible text (the exact v0.11.89 bug class)", async () => {
    await renderPopup();
    // Expand the "Customize for this site" and "By company" disclosures --
    // <details> content is only checked by a real browser's layout when
    // visible, and this is exactly the panel v0.11.89 broke.
    for (const details of document.querySelectorAll("details")) (details as HTMLDetailsElement).open = true;
    const findings = findInvisibleText(document.body);
    expect(findings).toEqual([]);
  });
});

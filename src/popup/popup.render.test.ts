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

// Each test re-imports the page module after vi.resetModules() and builds a
// full jsdom document; under a loaded full-suite run on a slower machine that
// cold import alone can pass vitest's 5s default. Local-only flake, green in CI.
vi.setConfig({ testTimeout: 20_000 });

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

async function renderPopup(hostname = "nytimes.com", siteDisabled = false): Promise<void> {
  const { browser } = createMockBrowser({ hostname, siteDisabled });
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(POPUP_HTML, [THEME_CSS]);
  await import("./popup");
  // Let the async render()/renderUiNotices()/renderSiteOverrides() chains
  // (each a real network of awaited sendMessage/storage calls) settle.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("popup.html render", () => {
  it("on a browser page, says Moat doesn't run there and offers nothing to act on", async () => {
    // hostnameOf gives "" for chrome://, about: and extension pages.
    await renderPopup("");
    expect(document.getElementById("internal-page-notice")!.hidden).toBe(false);
    expect(document.getElementById("stats")!.hidden).toBe(true);
    expect(document.getElementById("site-card")!.style.display).toBe("none");
    for (const id of ["start-picker", "fresh-start-button", "report-problem"]) {
      expect((document.getElementById(id) as HTMLElement).hidden, id).toBe(true);
    }
    expect(caughtErrors).toEqual([]);
  });

  it("on an already-paused site, says so without asking for a reload", async () => {
    await renderPopup("www.nytimes.com", true);
    expect(document.getElementById("paused-banner")!.hidden).toBe(false);
    expect(document.getElementById("paused-text")!.textContent).toBe("Moat is paused on nytimes.com.");
    expect(document.getElementById("reload-page")!.hidden).toBe(true);
  });

  it("right after pausing, asks for a reload and offers the button", async () => {
    await renderPopup("www.nytimes.com");
    const toggle = document.getElementById("site-toggle") as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(document.getElementById("paused-text")!.textContent).toBe("Moat is paused on nytimes.com. Reload the page to apply it.");
    expect(document.getElementById("reload-page")!.hidden).toBe(false);
  });

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

  it("says how many blocks the split hasn't sorted yet", async () => {
    await renderPopup();
    const line = document.getElementById("unsorted");
    expect(line?.hidden).toBe(false);
    expect(line?.textContent).toBe("Plus 4 more blocked");
    expect(document.getElementById("count")?.textContent).toBe("12");
  });
});

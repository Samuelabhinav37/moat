// @vitest-environment jsdom
//
// Renders the REAL logger.html + logger.ts (the Diagnostics page, DR-16/17)
// against a mocked webextension-polyfill, same reasoning as
// options.render.test.ts: a render-crash and an invisible-text check are
// cheap insurance against the exact bug classes this codebase has actually
// shipped on its other extension pages.
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBrowser } from "../shared/mockExtensionBrowser";
import { loadPageFixture } from "../shared/loadPageFixture";
import { findInvisibleText } from "../shared/findInvisibleText";

const LOGGER_HTML = join(__dirname, "logger.html");
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

async function renderLogger(): Promise<void> {
  const { browser } = createMockBrowser({ hostname: "example.com" });
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(LOGGER_HTML, [THEME_CSS]);
  await import("./logger");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("logger.html (Diagnostics) render", () => {
  it("actually finishes populating the page (catches a crash partway through render())", async () => {
    await renderLogger();
    expect(caughtErrors).toEqual([]);
    // 5 of the mock's 7 heuristics apply to the fixture's hostname (see
    // mockExtensionBrowser.ts's get-log-entries fixture) -- fingerprint and
    // cnameUncloak fired, cookieBannerReject and leakedPasswordCheck are on
    // but silent, feedAdRemoval is off; grayscaleAds/searchSlop don't apply
    // and are excluded from the list entirely.
    expect(document.querySelectorAll("#diag-heuristic-rows .heuristic-row").length).toBe(5);
    expect(document.getElementById("diag-host")?.textContent).toBe("example.com");
    expect(document.getElementById("diag-scope-note")?.hidden).toBe(false);
    expect(document.getElementById("diag-matches-table")?.hidden).toBe(false);
    expect(document.querySelectorAll("#diag-matches-body tr").length).toBe(1);
  });

  it("has no practically-invisible text (the v0.11.89 bug class)", async () => {
    await renderLogger();
    const findings = findInvisibleText(document.body);
    expect(findings).toEqual([]);
  });
});

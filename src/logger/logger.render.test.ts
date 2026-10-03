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
  vi.unstubAllGlobals();
});

async function renderLogger(entryCount?: number): Promise<void> {
  const { browser } = createMockBrowser({ hostname: "example.com" });
  if (entryCount !== undefined) {
    // A long session: blocks from the ads list, plus header-edit matches
    // from ruleset_privacy-headers that stop nothing.
    const real = browser.runtime.sendMessage;
    browser.runtime.sendMessage = (async (msg: { type: string }) => {
      const response = (await real(msg)) as Record<string, unknown>;
      if (msg.type !== "get-log-entries") return response;
      const entries = Array.from({ length: entryCount }, (_, i) => ({
        timestamp: Date.now() - i,
        url: `https://ads.example/${i}.js`,
        method: "GET",
        type: "script",
        ruleId: i % 2 ? 7 : 100,
        rulesetId: i % 2 ? "ruleset_privacy-headers" : "ads",
      }));
      return { ...response, entries };
    }) as typeof browser.runtime.sendMessage;
    // What rules/uncounted-rules.json says: rule 7 of privacy-headers stops nothing.
    vi.stubGlobal("fetch", async () => ({ json: async () => ({ "ruleset_privacy-headers": [7] }) }));
  }
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(LOGGER_HTML, [THEME_CSS]);
  await import("./logger");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("logger.html (Diagnostics) render", () => {
  it("shows blocked requests only by default, 200 at a time", async () => {
    await renderLogger(600);
    const rows = () => document.querySelectorAll("#diag-matches-body tr").length;
    // 300 of the 600 are header edits that block nothing.
    expect(rows()).toBe(200);
    const more = document.getElementById("diag-more") as HTMLButtonElement;
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe("Show 100 more");
    more.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toBe(300);
    expect(more.hidden).toBe(true);

    const blockedOnly = document.getElementById("diag-blocked-only") as HTMLInputElement;
    blockedOnly.checked = false;
    blockedOnly.dispatchEvent(new Event("change"));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toBe(200);
    expect(more.textContent).toBe("Show 200 more");
  });

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

  it("says what happened in a sentence, and keeps the raw numbers under Details", async () => {
    await renderLogger();
    expect(document.getElementById("diag-summary")?.textContent).toBe("On example.com, Moat hasn't blocked anything yet. 2 of 4 page checks ran.");
    const details = document.getElementById("diag-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.contains(document.getElementById("diag-matches-table"))).toBe(true);
    expect(details.contains(document.getElementById("diag-fired"))).toBe(true);
  });

  it("has no practically-invisible text (the v0.11.89 bug class)", async () => {
    await renderLogger();
    const findings = findInvisibleText(document.body);
    expect(findings).toEqual([]);
  });
});

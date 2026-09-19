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
  const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com" });
  // Every test in this file except the "Welcome panel" describe block below
  // is about the normal settings UI, not the first-run flow -- pre-seed as
  // already dismissed so #shell is the visible surface, same as any
  // non-fresh install. The welcome panel itself gets its own untouched mock.
  storageLocalData.uiState = { hasSeenWelcome: true };
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
    expect(document.getElementById("version-number")?.textContent).toBe("0.0.0-test");
    expect(document.getElementById("protection-groups")?.children.length).toBeGreaterThan(0);
    expect(caughtErrors).toEqual([]);
  });

  it("has no practically-invisible text across every tab (the v0.11.89 bug class)", async () => {
    await renderOptions();
    await visitEveryTab();
    const findings = findInvisibleText(document.body);
    expect(findings).toEqual([]);
  });

  it("hides the Firefox-only privacy.websites rows on the default (Chrome-shaped) mock", async () => {
    await renderOptions();
    expect(document.getElementById("protection-firefoxResistFingerprinting-label")).toBeNull();
    expect(document.getElementById("protection-firefoxFirstPartyIsolate-label")).toBeNull();
  });

  it("shows the Firefox-only privacy.websites rows when that API surface exists", async () => {
    const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com" });
    storageLocalData.uiState = { hasSeenWelcome: true };
    const websites = browser.privacy.websites as Record<string, unknown>;
    websites.resistFingerprinting = { set: () => Promise.resolve(), get: () => Promise.resolve({ value: false }) };
    websites.firstPartyIsolate = { set: () => Promise.resolve(), get: () => Promise.resolve({ value: false }) };
    vi.doMock("webextension-polyfill", () => ({ default: browser }));
    loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
    await import("./options");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.getElementById("protection-firefoxResistFingerprinting-label")).not.toBeNull();
    expect(document.getElementById("protection-firefoxFirstPartyIsolate-label")).not.toBeNull();
    // DR-15: the sync recipient must flip to Mozilla on a Firefox-shaped
    // build -- a wrong recipient here is a privacy-disclosure bug, not a
    // cosmetic one.
    document.querySelector<HTMLElement>(".rail-item[data-tab='about']")?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(document.getElementById("disclosure-sync-recipient")?.textContent).toBe("Mozilla");
    expect(document.getElementById("version-build")?.textContent).toBe("Firefox");
  });
});

describe("Backup tab (DR-15)", () => {
  it("shows the honest 'Never' state with the caution rail dot before any backup exists", async () => {
    await renderOptions();
    document.querySelector<HTMLElement>(".rail-item[data-tab='backup']")?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(document.getElementById("backup-metric-last")?.textContent).toBe("Never");
    expect(document.getElementById("backup-metric-last")?.classList.contains("caution")).toBe(true);
    expect((document.getElementById("rail-dot-backup") as HTMLElement | null)?.hidden).toBe(false);
    // Never hardcoded -- Google on this (default, Chrome-shaped) mock.
    expect(document.getElementById("sync-recipient")?.textContent).toBe("Google");
  });

  it("clicking Export actually records a backup and updates the tab live", async () => {
    const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com" });
    storageLocalData.uiState = { hasSeenWelcome: true };
    vi.doMock("webextension-polyfill", () => ({ default: browser }));
    loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
    // jsdom has no real Blob-URL machinery -- stub just the two static
    // methods the export handler calls (not the whole URL global, which
    // options.ts's own normalizeHostname/hostnameOf still need as a real
    // constructor) so the click resolves instead of throwing.
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    await import("./options");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(storageLocalData.lastBackupAt).toBeUndefined();
    (document.getElementById("export-settings-button") as HTMLButtonElement).click();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(typeof storageLocalData.lastBackupAt).toBe("number");
    document.querySelector<HTMLElement>(".rail-item[data-tab='backup']")?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(document.getElementById("backup-metric-last")?.textContent).not.toBe("Never");
    expect(document.getElementById("backup-metric-last")?.classList.contains("caution")).toBe(false);
    expect((document.getElementById("rail-dot-backup") as HTMLElement | null)?.hidden).toBe(true);
  });
});

describe("About tab (DR-13)", () => {
  it("renders the 5-row privacy disclosure table and a populated version grid", async () => {
    await renderOptions();
    document.querySelector<HTMLElement>(".rail-item[data-tab='about']")?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(document.querySelectorAll(".disclosure-table tbody tr").length).toBe(5);
    expect(document.getElementById("version-number")?.textContent).toBe("0.0.0-test");
    expect(document.getElementById("version-build")?.textContent).toBe("Chrome");
    // Must mirror the Filter Lists tab's own hero number exactly, never
    // recompute its own separate count -- see renderAboutTab's own comment
    // on why the two must never disagree. (This jsdom harness has no real
    // rules/manifest.json to fetch, so both sides read the same "—"
    // placeholder rather than a real count -- that's still the behavior
    // under test: agreement, not a specific value.)
    expect(document.getElementById("version-rules")?.textContent).toBe(document.getElementById("filters-metric-active")?.textContent);
    expect(document.getElementById("disclosure-sync-recipient")?.textContent).toBe("Google");
  });
});

describe("Welcome panel (first run)", () => {
  it("shows over #shell on a fresh install (no uiState in storage yet)", async () => {
    const { browser } = createMockBrowser({ hostname: "example.com" });
    // Deliberately NOT seeding uiState -- this is the one test in the file
    // that wants the real "never seen it before" state renderOptions()
    // pre-dismisses for every other test.
    vi.doMock("webextension-polyfill", () => ({ default: browser }));
    loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
    await import("./options");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((document.getElementById("welcome-panel") as HTMLElement | null)?.hidden).toBe(false);
    expect((document.getElementById("shell") as HTMLElement | null)?.hidden).toBe(true);
    expect(caughtErrors).toEqual([]);
  });

  it("clicking Continue actually dismisses it and reveals the real settings UI", async () => {
    const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com" });
    vi.doMock("webextension-polyfill", () => ({ default: browser }));
    loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
    await import("./options");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(storageLocalData.uiState).toBeUndefined();
    (document.getElementById("welcome-continue") as HTMLButtonElement).click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect((storageLocalData.uiState as { hasSeenWelcome?: boolean } | undefined)?.hasSeenWelcome).toBe(true);
    expect((document.getElementById("welcome-panel") as HTMLElement | null)?.hidden).toBe(true);
    expect((document.getElementById("shell") as HTMLElement | null)?.hidden).toBe(false);
    // The real settings UI underneath was already populated while the
    // panel was up, not left as an empty shell needing its own load.
    expect(document.getElementById("protection-groups")?.children.length).toBeGreaterThan(0);
  });

  it("stays hidden once already dismissed", async () => {
    const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com" });
    storageLocalData.uiState = { hasSeenWelcome: true };
    vi.doMock("webextension-polyfill", () => ({ default: browser }));
    loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
    await import("./options");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((document.getElementById("welcome-panel") as HTMLElement | null)?.hidden).toBe(true);
    expect((document.getElementById("shell") as HTMLElement | null)?.hidden).toBe(false);
  });
});

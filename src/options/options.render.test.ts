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
import type { Settings } from "../types";
import { presetPatch } from "../shared/filterPresets";

const OPTIONS_HTML = join(__dirname, "options.html");
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

async function renderOptions(settings?: Partial<Settings>): Promise<void> {
  const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com", settings });
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

/** Opens Advanced settings and every disclosure inside it, so each
 * section is actually on screen -- the Trackers breakdown, for one, is only
 * fetched once its own <details> opens. */
async function openEverything(): Promise<void> {
  (document.getElementById("advanced-toggle") as HTMLButtonElement).click();
  for (const details of document.querySelectorAll("details")) (details as HTMLDetailsElement).open = true;
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
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
    expect(document.getElementById("feature-rows")?.children.length).toBe(4);
    expect(caughtErrors).toEqual([]);
  });

  it("has no practically-invisible text with Advanced settings open (the v0.11.89 bug class)", async () => {
    await renderOptions();
    await openEverything();
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
    expect(document.getElementById("disclosure-sync-recipient")?.textContent).toBe("Mozilla");
    expect(document.getElementById("version-build")?.textContent).toBe("Firefox");
  });
});

describe("Previously-orphaned i18n keys that turned out to be real content gaps", () => {
  // Regression: optionsHiddenElementsTitle/Hint, optionsIndividualListsHint,
  // and optionsPermissionGuardMergedDesc all existed as translated message
  // keys with zero references anywhere in the markup -- discovered by an
  // audit's orphaned-key scan, then confirmed (not assumed) to be genuine
  // missing content rather than rename cruft by checking each one's
  // plausible location against its sibling sections.
  it("'Things you've hidden' has its own heading and hint", async () => {
    await renderOptions();

    expect(document.body.textContent).toContain("Things you've hidden");
    expect(document.body.textContent).toContain("Block an element");
  });

  it("Filter lists: the individual lists have a hint saying what changing one does", async () => {
    await renderOptions();

    expect(document.body.textContent).toContain("switches your level to Custom");
  });

  it("Privacy extras: the merged permission-guard row has an explanatory line, not just a title and chips", async () => {
    await renderOptions();
    expect(document.body.textContent).toContain("Allow a site from the popup when you trust it");
  });
});

describe("Backup and sync (DR-15)", () => {
  it("shows the honest 'Never' state in amber before any backup exists", async () => {
    await renderOptions();

    expect(document.getElementById("backup-metric-last")?.textContent).toBe("Never");
    expect(document.getElementById("backup-metric-last")?.classList.contains("caution")).toBe(true);
    // Never hardcoded -- Google on this (default, Chrome-shaped) mock.
    expect(document.getElementById("sync-recipient")?.textContent).toBe("Google");
  });

  it("clicking Export actually records a backup and updates the line live", async () => {
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
    expect(document.getElementById("backup-metric-last")?.textContent).not.toBe("Never");
    expect(document.getElementById("backup-metric-last")?.classList.contains("caution")).toBe(false);
  });
});

describe("About Moat (DR-13)", () => {
  it("renders the 5-row privacy disclosure table and a populated version grid", async () => {
    await renderOptions();

    expect(document.querySelectorAll(".disclosure-table tbody tr").length).toBe(5);
    expect(document.getElementById("version-number")?.textContent).toBe("0.0.0-test");
    expect(document.getElementById("version-build")?.textContent).toBe("Chrome");
    // This jsdom harness has no real rules/manifest.json to fetch, so the
    // count stays the "—" placeholder rather than a made-up number.
    expect(document.getElementById("version-rules")?.textContent).toBe("—");
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

describe("Block and allow: migration import", () => {
  it("parses pasted text, actually writes the result to storage, and reports real counts", async () => {
    const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com" });
    storageLocalData.uiState = { hasSeenWelcome: true };
    vi.doMock("webextension-polyfill", () => ({ default: browser }));
    loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
    await import("./options");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    (document.getElementById("migration-import") as HTMLDetailsElement).open = true;

    const textarea = document.getElementById("migration-import-textarea") as HTMLTextAreaElement;
    textarea.value = ["||ads.example.com^", "@@||shop.example.com^", "example.com##.ad-banner", "##.generic-no-domain"].join("\n");
    (document.getElementById("migration-import-button") as HTMLButtonElement).click();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const settings = storageLocalData.settings as {
      customBlockedDomains: string[];
      customAllowedDomains: string[];
      customCosmeticRules: Record<string, string[]>;
    };
    expect(settings.customBlockedDomains).toContain("ads.example.com");
    expect(settings.customAllowedDomains).toContain("shop.example.com");
    expect(settings.customCosmeticRules["example.com"]).toContain(".ad-banner");

    const status = document.getElementById("migration-import-status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain("1");
    expect(textarea.value).toBe("");

    // The Block and allow lists re-render from the new state without
    // a full page reload -- not just a background write nobody sees.
    expect(document.getElementById("custom-block-list")?.textContent).toContain("ads.example.com");
    expect(document.getElementById("custom-allow-list")?.textContent).toContain("shop.example.com");
  });

  it("reports that nothing was recognized, for text with no supported syntax", async () => {
    await renderOptions();

    const textarea = document.getElementById("migration-import-textarea") as HTMLTextAreaElement;
    textarea.value = "/some-regex-filter/";
    (document.getElementById("migration-import-button") as HTMLButtonElement).click();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(document.getElementById("migration-import-status")?.hidden).toBe(false);
    expect(document.getElementById("migration-import-status")?.textContent).not.toBe("");
  });
});

describe("One-page layout", () => {
  it("keeps Advanced settings collapsed until its button is pressed", async () => {
    await renderOptions();
    const toggle = document.getElementById("advanced-toggle") as HTMLButtonElement;
    const advanced = document.getElementById("advanced") as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(advanced.hidden).toBe(true);

    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(advanced.hidden).toBe(false);
    expect(document.getElementById("advanced-toggle-title")?.textContent).toBe("Hide advanced settings");

    toggle.click();
    expect(advanced.hidden).toBe(true);
    expect(document.getElementById("advanced-toggle-title")?.textContent).toBe("Advanced settings");
  });

  it("selects no level card for a hand-picked mix, and points to Advanced settings", async () => {
    // The shared mock is deliberately a custom mix (fingerprinting on, etc.).
    await renderOptions();
    const checkedCards = document.querySelectorAll("#level-cards .level[aria-checked='true']");
    expect(checkedCards.length).toBe(0);
    expect((document.getElementById("level-note") as HTMLElement).hidden).toBe(false);
  });

  it("marks exactly one level card as chosen, and picking another one saves it", async () => {
    await renderOptions({ ...presetPatch("standard") });
    const checked = () =>
      [...document.querySelectorAll<HTMLButtonElement>("#level-cards .level")]
        .filter((card) => card.getAttribute("aria-checked") === "true")
        .map((card) => card.dataset.level);
    expect(checked()).toEqual(["standard"]);
    expect((document.getElementById("level-note") as HTMLElement).hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#level-cards .level[data-level='strict']")!.click();
    await settle();
    expect(checked()).toEqual(["strict"]);
  });

  it("shows the friendly empty states when nothing is paused or hidden", async () => {
    await renderOptions({ disabledSites: [], customCosmeticRules: {}, customGrayscaleRules: {} });
    expect(document.getElementById("site-list")?.children.length).toBe(0);
    expect(document.getElementById("site-empty-state")?.style.display).not.toBe("none");
    expect(document.getElementById("hidden-element-empty")?.style.display).not.toBe("none");
    expect((document.getElementById("grayscale-element-block") as HTMLElement).hidden).toBe(true);
  });
});

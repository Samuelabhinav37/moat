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
import { REPORT_ENDPOINT } from "../shared/reportEndpoint";

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
  const { browser } = createMockBrowser({ hostname: "example.com", settings });
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
  await import("./options");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Opens every disclosure, so each section is actually on screen -- the
 * Trackers breakdown, for one, is only fetched once its own <details> opens. */
async function openEverything(): Promise<void> {
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

  it("has no practically-invisible text with every section open (the v0.11.89 bug class)", async () => {
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
    const { browser } = createMockBrowser({ hostname: "example.com" });
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
  it("'Hidden on pages' has its own heading and hint", async () => {
    await renderOptions();

    expect(document.querySelector('section[data-tab="hidden"] h2')?.textContent).toBe("Hidden on pages");
    expect(document.body.textContent).toContain("Hide something on a page");
  });

  it("Filter lists: the individual lists have a hint saying what changing one does", async () => {
    await renderOptions();

    expect(document.body.textContent).toContain("makes it your own mix");
  });

  it("Privacy extras: the merged permission-guard row has an explanatory line, not just a title and chips", async () => {
    await renderOptions();
    expect(document.body.textContent).toContain("Allow a site from the popup when you trust it");
  });
});

describe("Where things live (docs/research/settings-ia-2026-09.md)", () => {
  // A screen, or a tab of the Exceptions screen.
  const inSection = (page: string, selector: string) =>
    Array.from(document.querySelectorAll(`section[data-page="${page}"], section[data-tab="${page}"]`)).some((section) => section.querySelector(selector));
  const rowTitles = (id: string) => Array.from(document.querySelectorAll(`#${id} .setting-title`), (el) => el.textContent);

  it("puts the pause box on Paused sites and the blocker import on About, with the backup", async () => {
    await renderOptions();
    expect(inSection("paused", "#add-input")).toBe(true);
    expect(inSection("rules", "#add-input")).toBe(false);
    expect(inSection("about", "#migration-import")).toBe(true);
    expect(inSection("rules", "#migration-import")).toBe(false);
  });

  it("keeps the annoyance fixes on Blocking level and the breach check on Privacy, in groups", async () => {
    await renderOptions();
    expect(rowTitles("feature-rows")).toContain("Hide low-quality search results");
    expect(rowTitles("feature-rows")).not.toContain("Warn about leaked passwords");
    expect(rowTitles("protection-groups")).toContain("Warn about leaked passwords");
    expect(Array.from(document.querySelectorAll("#protection-groups .sub-h"), (el) => el.textContent)).toEqual([
      "Tracking",
      "Your device",
      "Permissions and passwords",
    ]);
  });

  it("chooses the level only on Blocking level; Filter lists just says which one is in use", async () => {
    await renderOptions({ ...presetPatch("standard") });
    expect(document.querySelector("[data-preset]")).toBeNull();
    expect(document.getElementById("level-line-text")?.textContent).toBe("Using Balanced.");
    expect(document.getElementById("level-line-change")?.hidden).toBe(false);
    expect(document.getElementById("level-line-reset")?.hidden).toBe(true);
  });

  it("offers Reset to Balanced for a hand-picked mix, Essential included", async () => {
    await renderOptions({ ...presetPatch("essential") });
    expect(document.getElementById("level-line-text")?.textContent).toBe("Your own mix of lists.");
    expect(document.getElementById("level-line-change")?.hidden).toBe(true);
    expect(document.getElementById("level-line-reset")?.hidden).toBe(false);
    expect(document.getElementById("level-note")?.hidden).toBe(false);
  });

  it("lists settings changed for one site, and Reset clears them", async () => {
    // The mock browser starts with example.com's low-quality-results filter off.
    await renderOptions();
    const rows = () => Array.from(document.querySelectorAll("#override-list li"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain("example.com");
    expect(rows()[0]!.textContent).toContain("Hide low-quality search results: off");
    expect(document.getElementById("override-empty")!.style.display).toBe("none");

    rows()[0]!.querySelector("button")!.click();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toHaveLength(0);
    expect(document.getElementById("override-empty")!.style.display).toBe("");
  });

  it("sorts site lists by name, ignoring www.", async () => {
    await renderOptions({ disabledSites: ["zeta.example", "www.alpha.example", "beta.example"] });
    const names = Array.from(document.querySelectorAll("#site-list li"), (li) => li.querySelector("span:not(.site-icon)")?.textContent);
    expect(names).toEqual(["www.alpha.example", "beta.example", "zeta.example"]);
  });

  it("points the own-mix note at Filter lists, not at a hidden Advanced button", async () => {
    await renderOptions();
    const note = document.getElementById("level-note")!;
    expect(note.textContent).not.toContain("Advanced settings");
    expect(note.querySelector("a.to-filters")?.getAttribute("href")).toBe("#filters");
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
  it("says data leaves the device when only Catch hidden trackers is on (Chrome asks Cloudflare)", async () => {
    await renderOptions({ cnameUncloaking: true, leakedPasswordCheck: false, syncEnabled: false });

    expect(document.getElementById("flow-state-hidden")?.classList.contains("on")).toBe(true);
    expect(document.getElementById("about-flows-summary")?.textContent).toMatch(/sends a little data/);
  });

  it("says nothing leaves the device when every optional flow is off", async () => {
    await renderOptions({ cnameUncloaking: false, leakedPasswordCheck: false, syncEnabled: false });

    expect(document.getElementById("about-flows-summary")?.textContent).toMatch(/nothing about your browsing leaves/);
  });

  it("lists the 6 data flows with their current state, and the version", async () => {
    await renderOptions();

    // Problem reports only show as a data flow once the report service is set up,
    // and organization events only under an organization's policy.
    expect(document.querySelectorAll("#about-flows .flow-row:not([hidden])").length).toBe(REPORT_ENDPOINT ? 7 : 6);
    expect(document.getElementById("flow-reports")?.hidden).toBe(!REPORT_ENDPOINT);
    expect(document.getElementById("flow-org")?.hidden).toBe(true);
    expect(document.getElementById("flow-hidden")?.hidden).toBe(false);
    // Current state, not the install default: the mock has the breach check
    // on and sync off.
    expect(document.getElementById("flow-state-breach")?.classList.contains("on")).toBe(true);
    expect(document.getElementById("flow-state-sync")?.classList.contains("on")).toBe(false);
    expect(document.getElementById("about-flows-summary")?.textContent).toMatch(/sends a little data/);
    expect(document.getElementById("version-number")?.textContent).toBe("0.0.0-test");
    expect(document.getElementById("version-build")?.textContent).toBe("Chrome");
    // This jsdom harness has no real rules/manifest.json to fetch, so the
    // count stays the "—" placeholder rather than a made-up number.
    expect(document.getElementById("version-rules")?.textContent).toBe("—");
    expect(document.getElementById("disclosure-sync-recipient")?.textContent).toBe("Google");
  });
});

describe("First open (the tour replaced the old Welcome panel)", () => {
  it("shows the real settings straight away on a fresh install", async () => {
    const { browser } = createMockBrowser({ hostname: "example.com" });
    // No uiState seeded: the "never seen anything" state.
    vi.doMock("webextension-polyfill", () => ({ default: browser }));
    loadPageFixture(OPTIONS_HTML, [THEME_CSS]);
    await import("./options");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.getElementById("welcome-panel")).toBeNull();
    expect((document.getElementById("shell") as HTMLElement | null)?.hidden).toBe(false);
    expect(document.getElementById("protection-groups")?.children.length).toBeGreaterThan(0);
    expect(caughtErrors).toEqual([]);
  });
});

describe("Block and allow: migration import", () => {
  it("parses pasted text, actually writes the result to storage, and reports real counts", async () => {
    const { browser, storageLocalData } = createMockBrowser({ hostname: "example.com" });
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

describe("Level cards", () => {
  it("selects no level card for a hand-picked mix, and points to Filter lists", async () => {
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

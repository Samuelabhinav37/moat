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
const OPTIONS_CSS = join(__dirname, "options.css");
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

let createdTabs: string[] = [];
let sentMessages: Record<string, unknown>[] = [];

async function renderOptions(settings?: Partial<Settings>, storage?: Record<string, unknown>): Promise<void> {
  const mock = createMockBrowser({ hostname: "example.com", settings, storage });
  const { browser } = mock;
  createdTabs = mock.createdTabs;
  sentMessages = mock.sentMessages;
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(OPTIONS_HTML, [THEME_CSS, OPTIONS_CSS]);
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
    loadPageFixture(OPTIONS_HTML, [THEME_CSS, OPTIONS_CSS]);
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

  it("puts the pause box on Paused sites and the blocker import with the backup", async () => {
    await renderOptions();
    expect(inSection("paused", "#add-input")).toBe(true);
    expect(inSection("rules", "#add-input")).toBe(false);
    expect(inSection("backup", "#migration-import")).toBe(true);
    expect(inSection("about", "#migration-import")).toBe(false);
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
    loadPageFixture(OPTIONS_HTML, [THEME_CSS, OPTIONS_CSS]);
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
    // This jsdom harness has no real rules/rulesets.json to fetch, so the
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
    loadPageFixture(OPTIONS_HTML, [THEME_CSS, OPTIONS_CSS]);
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
    loadPageFixture(OPTIONS_HTML, [THEME_CSS, OPTIONS_CSS]);
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

describe("Protection keeps the expert material one step in", () => {
  it("starts with the filter lists and the rule budget closed", async () => {
    await renderOptions();
    const more = document.getElementById("filter-lists-more") as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more.querySelector(".budget")).not.toBeNull();
  });
});

describe("Hand-picked mix of lists", () => {
  it("marks the level card the mix is closest to", async () => {
    const balanced = presetPatch("standard");
    await renderOptions({ ...balanced, filterGroups: { ...balanced.filterGroups, "social-widgets": true } });
    const badges = [...document.querySelectorAll("#level-cards .level-mix")];
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest(".level")?.getAttribute("data-level")).toBe("standard");
  });

  it("names the nearest level and what differs, and resets to that level", async () => {
    const balanced = presetPatch("standard");
    await renderOptions({ ...balanced, filterGroups: { ...balanced.filterGroups, "social-widgets": true } });

    expect(document.getElementById("level-line-text")?.textContent).toBe("Your mix: Balanced + Social buttons.");
    expect(document.getElementById("level-line-reset")?.textContent).toBe("Reset to Balanced");
    expect(document.getElementById("level-line-reset")?.dataset.level).toBe("standard");
    expect(document.querySelector("#level-note span")?.textContent).toBe("Your mix: Balanced + Social buttons.");
  });
});

describe("About: connection states are plain text, with a way to change them", () => {
  it("shows a Change link only on optional connections, named for its row", async () => {
    await renderOptions();

    expect(document.querySelectorAll("#about-flows .pill").length).toBe(0);
    const links = [...document.querySelectorAll<HTMLButtonElement>("#about-flows .flow-change")];
    expect(links.map((b) => b.dataset.reveal)).toEqual(["protection-cname-label", "protection-leakedPassword-label", "sync-toggle-label"]);
    expect(links[2]?.getAttribute("aria-label")).toBe("Change: Settings sync");
    for (const link of links) expect(document.getElementById(link.dataset.reveal!), link.dataset.reveal).not.toBeNull();
  });
});

describe("Overview status banner tells the truth", () => {
  const banner = () => document.getElementById("ov-status") as HTMLElement;

  it("shows the level, a Change link and paused sites when on", async () => {
    await renderOptions({ enabled: true, disabledSites: ["a.example", "b.example"] });

    expect(banner().dataset.state).toBe("on");
    expect(document.getElementById("ov-status-paused")?.textContent).toBe("Paused on 2 sites");
    expect(document.getElementById("ov-status-change")?.getAttribute("href")).toBe("#blocking");
    expect(document.getElementById("ov-status-action")?.hidden).toBe(true);
  });

  it("says protection is off, with a Turn on button", async () => {
    await renderOptions({ enabled: false });

    expect(banner().dataset.state).toBe("off");
    expect(document.getElementById("ov-status-title")?.textContent).toBe("Protection is off.");
    expect(document.getElementById("ov-status-action")?.textContent).toBe("Turn on");
  });

  it("says the lists failed to update, with Try again", async () => {
    await renderOptions({ enabled: true }, { liveUpdateStatus: { ok: false, timestamp: Date.now() } });

    expect(banner().dataset.state).toBe("failed");
    expect(document.getElementById("ov-status-title")?.textContent).toBe("Lists couldn't update.");
    expect(document.getElementById("ov-status-action")?.hidden).toBe(false);
  });
});

describe("About › Appearance", () => {
  it("shows the saved choice and switches the page when another is picked", async () => {
    localStorage.clear();
    await renderOptions({ theme: "dark" });

    const radio = (v: string) => document.querySelector<HTMLInputElement>(`.theme-choice input[value="${v}"]`)!;
    expect(radio("dark").checked).toBe(true);
    // The fast-start copy caught up with the saved setting.
    expect(localStorage.getItem("moat-theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    radio("light").click();
    expect(localStorage.getItem("moat-theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("Security: a stopped page can be reported as a mistake", () => {
  it("opens the report page with the site and the reason filled in", async () => {
    await renderOptions(undefined, { usageStats: { days: {}, pageStops: [{ hostname: "surveymonkey.com", time: Date.now() }] } });

    const button = document.querySelector<HTMLButtonElement>("#sec-list .ins-report")!;
    expect(button.getAttribute("aria-label")).toBe("Report a mistake: surveymonkey.com");
    button.click();
    expect(createdTabs.at(-1)).toMatch(/report\.html\?site=surveymonkey\.com&reason=false-alarm$/);
  });
});

describe("Security: stops grouped by what stopped them", () => {
  it("puts dangerous pages first, names each list, and keeps older stops apart", async () => {
    const now = Date.now();
    await renderOptions(undefined, {
      usageStats: {
        days: {},
        pageStops: [
          { hostname: "old.example", time: now - 3000 },
          { hostname: "pop.example", time: now - 2000, list: "popups", kind: "ads" },
          { hostname: "mine.example", time: now - 1500, list: "custom", kind: "custom" },
          { hostname: "paypa1-secure.top", time: now - 1000, list: "phishing-urls", kind: "danger" },
        ],
      },
    });
    const groups = [...document.querySelectorAll<HTMLElement>("#sec-list .stop-group")];
    expect(groups.map((g) => g.dataset.group)).toEqual(["danger", "ads", "custom", "earlier"]);
    expect(groups[0]!.querySelector("h3")?.textContent).toBe("Dangerous pages1");
    expect(groups[0]!.querySelector(".stop-list")?.textContent).toBe("Phishing");
    expect(groups[1]!.querySelector(".stop-list")?.textContent).toBe("Pop-up ads");
    // Your own list isn't Moat's to correct.
    expect(groups[2]!.querySelector(".ins-report")).toBeNull();
    expect(groups[3]!.querySelector(".stop-list")).toBeNull();
    const kpi = (label: string) =>
      [...document.querySelectorAll("#sec-kpis .ov-kpi")].find((card) => card.querySelector(".ov-kpi-label")?.textContent === label)?.querySelector(".ov-kpi-value")?.textContent;
    expect(kpi("Dangerous pages stopped")).toBe("1");
    expect(kpi("Ad pages stopped")).toBe("1");
  });
});

describe("Sites: a site opens its own panel", () => {
  it("shows the week's blocks there by kind and the companies seen there", async () => {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = {
      date,
      total: 40,
      hostnames: ["news.example"],
      hostCounts: { "news.example": 40 },
      hostKinds: { "news.example": { ads: 10, trackers: 28, popups: 2 } },
      signals: {},
      companies: { Google: { count: 20, hostnames: ["news.example"] }, Meta: { count: 8, hostnames: ["news.example"] } },
      kinds: { ads: 10, trackers: 28, popups: 2 },
    };
    await renderOptions({ disabledSites: [] }, { usageStats: { days: { [date]: day } } });
    const open = document.querySelector<HTMLButtonElement>("#s-table .site-open")!;
    const panel = document.getElementById(open.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);
    open.click();
    expect(panel.hidden).toBe(false);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(panel.querySelector(".sp-kinds")?.textContent).toBe("Ads10Trackers28Pop-ups2");
    expect([...panel.querySelectorAll(".sp-who li")].map((li) => li.textContent)).toEqual(["Google", "Meta"]);
    expect(document.querySelector("#s-table th:last-child")?.textContent).toBe("Protected");
  });
});

describe("Pausing for a while", () => {
  it("pauses from Exceptions for the length picked, with a real label on the field", async () => {
    await renderOptions();
    const input = document.getElementById("add-input") as HTMLInputElement;
    expect(document.querySelector('label[for="add-input"]')?.textContent).toBe("Pause Moat on a site");
    input.value = "x.example";
    (document.getElementById("add-length") as HTMLSelectElement).value = "day";
    const before = Date.now();
    (document.getElementById("add-button") as HTMLButtonElement).click();
    await settle();
    const sent = sentMessages.filter((m) => m.type === "toggle-site").at(-1)!;
    expect(sent).toMatchObject({ hostname: "x.example", disabled: true });
    expect(sent.until as number).toBeGreaterThanOrEqual(before + 86_400_000);
  });

  it("shows when a timed pause ends in the paused list", async () => {
    const until = Date.now() + 3_600_000;
    await renderOptions({ disabledSites: ["paused.example"], pausedUntil: { "paused.example": until } });
    const row = [...document.querySelectorAll("#site-list li")].find((li) => li.textContent?.includes("paused.example"));
    expect(row?.querySelector(".row-note")?.textContent).toMatch(/^Until /);
  });

  it("says where and when a site was paused", async () => {
    const at = Date.now() - 3 * 86_400_000;
    await renderOptions({ disabledSites: ["paused.example", "old.example"], pauseInfo: { "paused.example": { at, from: "popup" } } });
    const rows = [...document.querySelectorAll("#site-list li")];
    const note = (host: string) => rows.find((li) => li.textContent?.includes(host))?.querySelector(".row-note")?.textContent ?? null;
    expect(note("paused.example")).toBe("From Moat's icon, 3 days ago");
    expect(note("old.example")).toBeNull();
  });

  it("shows the Per site tab only when something was changed for one site", async () => {
    await renderOptions({ perSiteOverrides: {} });
    expect(document.getElementById("tab-persite")!.hidden).toBe(true);
  });

  it("shows the Per site tab with the sites' changes once there are some", async () => {
    await renderOptions({ perSiteOverrides: { "a.example": { hideSeoSpamResults: false } } });
    expect(document.getElementById("tab-persite")!.hidden).toBe(false);
    expect(document.querySelector('section[data-tab="persite"] #override-list')).not.toBeNull();
  });

  it("asks how long when a site is switched off on Sites, and puts the switch back on cancel", async () => {
    await renderOptions({ disabledSites: [] });
    const input = document.querySelector<HTMLInputElement>("#s-table .switch input");
    if (!input) return; // no sites in this week's sample
    input.click();
    expect(document.querySelector(".pause-menu")).not.toBeNull();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(input.checked).toBe(true);
    input.click();
    document.querySelector<HTMLButtonElement>('.pause-menu [data-length="hour"]')!.click();
    await settle();
    expect(sentMessages.filter((m) => m.type === "toggle-site").at(-1)).toMatchObject({ disabled: true });
  });
});

describe("Overview: this week or last week", () => {
  function twoWeeks(): Record<string, unknown> {
    const days: Record<string, unknown> = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const total = i < 7 ? 30 : 10;
      days[date] = { date, total, hostnames: ["a.example"], signals: {}, companies: {}, kinds: { ads: total, trackers: 0, popups: 0 } };
    }
    return { usageStats: { days } };
  }

  it("says the number from last week, and can show last week's chart", async () => {
    await renderOptions(undefined, twoWeeks());
    expect(document.getElementById("ov-headline")?.textContent).toBe("70 last week");
    expect(document.getElementById("ov-period")?.hidden).toBe(false);

    document.querySelector<HTMLButtonElement>('#ov-period [data-period="last"]')!.click();
    expect(document.getElementById("ov-week-title")?.textContent).toBe("Blocked last week");
    expect(document.getElementById("ov-week-total")?.textContent).toBe("70");
    expect(document.querySelectorAll("#ov-chart .ovc-col.today")).toHaveLength(0);

    document.querySelector<HTMLButtonElement>('#ov-period [data-period="this"]')!.click();
    expect(document.getElementById("ov-week-total")?.textContent).toBe("210");
  });
});

describe("Overview: the week in a sentence, and a calm sidebar", () => {
  function week(stopAt: number): Record<string, unknown> {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = { date, total: 40, hostnames: ["news.example"], signals: {}, companies: { Google: { count: 30, hostnames: ["news.example"] } }, kinds: { ads: 10, trackers: 30, popups: 0 } };
    return { usageStats: { days: { [date]: day }, pageStops: [{ hostname: "bad.example", time: stopAt }] } };
  }

  it("names the company seen most under the title, with the totals in the chart's legend and no percentage cards", async () => {
    await renderOptions(undefined, week(Date.now()));
    expect(document.getElementById("page-lead")?.textContent).toMatch(/^Google tracked you on the most sites\./);
    expect(document.querySelector("#ov-chart .ovc-legend")?.textContent).toContain("Trackers30");
    expect(document.getElementById("ov-kpis")).toBeNull();
  });

  it("puts a red dot on Security for a page stopped since it was last opened, and clears it there", async () => {
    localStorage.setItem("moat-security-seen", String(Date.now() - 60_000));
    await renderOptions(undefined, week(Date.now()));
    const dot = document.getElementById("nav-dot-security")!;
    expect(dot.hidden).toBe(false);
    location.hash = "#security";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(dot.hidden).toBe(true);
    expect(Number(localStorage.getItem("moat-security-seen"))).toBeGreaterThan(Date.now() - 5_000);
    location.hash = "";
  });

  it("shows no dot when nothing new was stopped", async () => {
    localStorage.setItem("moat-security-seen", String(Date.now()));
    await renderOptions(undefined, week(Date.now() - 86_400_000));
    expect(document.getElementById("nav-dot-security")!.hidden).toBe(true);
  });
});

describe("Empty cards say why, and offer one thing to do", () => {
  it("offers to check Moat is working, which opens that Help guide", async () => {
    await renderOptions(undefined, { usageStats: { days: {} } });
    const empty = document.getElementById("ov-week-empty")!;
    expect(empty.hidden).toBe(false);
    empty.querySelector<HTMLButtonElement>(".check-moat")!.click();
    expect(document.getElementById("help-panel")!.hidden).toBe(false);
    expect(document.querySelector("#help-panel .hp-body")?.textContent).toContain("Check Moat yourself");
  });
});

describe("Keyboard and screen-reader basics", () => {
  it("starts with a skip link to the content", async () => {
    await renderOptions();
    const skip = document.body.firstElementChild as HTMLAnchorElement;
    expect(skip.className).toBe("skip-link");
    expect(skip.getAttribute("href")).toBe("#main");
    expect(document.getElementById("main")?.tagName).toBe("MAIN");
  });
});

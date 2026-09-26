// @vitest-environment jsdom
//
// Renders the real welcome.html + welcome.ts against a mocked browser, the
// same way popup.render.test.ts does for the popup: no crash, no invisible
// text, the steps move, and the pin status follows what the browser reports.
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockBrowser } from "../shared/mockExtensionBrowser";
import { loadPageFixture } from "../shared/loadPageFixture";
import { findInvisibleText } from "../shared/findInvisibleText";

const WELCOME_HTML = join(__dirname, "welcome.html");
const THEME_CSS = join(__dirname, "..", "ui", "theme.css");

vi.setConfig({ testTimeout: 20_000 });

let caughtErrors: unknown[] = [];
let pinned: boolean;
let pinListener: ((change: { isOnToolbar?: boolean }) => void) | undefined;
const removeTab = vi.fn(() => Promise.resolve());

beforeEach(() => {
  vi.resetModules();
  caughtErrors = [];
  pinned = false;
  pinListener = undefined;
  removeTab.mockClear();
  window.addEventListener("error", (e) => caughtErrors.push(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => caughtErrors.push(e.reason));
  vi.stubGlobal("chrome", {
    action: {
      getUserSettings: () => Promise.resolve({ isOnToolbar: pinned }),
      onUserSettingsChanged: {
        addListener: (l: typeof pinListener) => (pinListener = l),
        removeListener: () => {},
      },
    },
  });
});

afterEach(() => {
  vi.doUnmock("webextension-polyfill");
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function renderTour() {
  const mock = createMockBrowser();
  const browser = {
    ...mock.browser,
    tabs: { ...mock.browser.tabs, getCurrent: () => Promise.resolve({ id: 7 }), remove: removeTab },
  };
  vi.doMock("webextension-polyfill", () => ({ default: browser }));
  loadPageFixture(WELCOME_HTML, [THEME_CSS]);
  await import("./welcome");
  await settle();
  return mock.storageLocalData;
}

const next = () => (document.getElementById("next") as HTMLButtonElement).click();
const visibleStep = () => document.querySelector<HTMLElement>(".rail [data-step].active")?.dataset.step;

describe("welcome.html (first-run tour)", () => {
  it("renders without errors or invisible text", async () => {
    await renderTour();
    expect(caughtErrors).toEqual([]);
    expect(findInvisibleText(document.body)).toEqual([]);
    expect(document.getElementById("step-label")?.textContent).toBe("Step 1 of 4");
  });

  it("swaps between the two real sites", async () => {
    await renderTour();
    expect(document.getElementById("facts")?.textContent).toContain("The ad at the top is gone");
    expect(document.querySelectorAll("#facts li").length).toBe(3);
    (document.querySelector('.tabs [data-site="forbes"]') as HTMLButtonElement).click();
    expect(document.getElementById("url")?.textContent).toBe("https://www.forbes.com/");
    expect(document.getElementById("facts")?.textContent).toContain("The banner under the menu is gone");
    (document.getElementById("on") as HTMLButtonElement).click();
    expect(document.getElementById("shot")?.classList.contains("moat")).toBe(true);
  });

  it("walks through all four steps", async () => {
    await renderTour();
    next();
    expect(visibleStep()).toBe("2");
    expect(document.querySelectorAll(".req.stop").length).toBe(6);
    next();
    await settle();
    expect(visibleStep()).toBe("3");
    next();
    expect(visibleStep()).toBe("4");
    expect(document.getElementById("next")?.textContent).toBe("Start browsing");
  });

  it("the pin step follows the browser: unpinned, then pinned", async () => {
    await renderTour();
    next();
    next();
    await settle();
    expect(document.getElementById("status")?.hidden).toBe(false);
    expect(document.getElementById("status-text")?.textContent).toBe("Moat isn't pinned yet");
    expect(document.getElementById("next")?.textContent).toBe("Continue without pinning");
    pinListener!({ isOnToolbar: true });
    expect(document.getElementById("status-text")?.textContent).toBe("Pinned. Moat is next to your address bar.");
    expect(document.getElementById("next")?.textContent).toBe("Continue");
  });

  it("says 'Already pinned' when the browser pinned Moat before the tour", async () => {
    pinned = true;
    await renderTour();
    next();
    next();
    await settle();
    expect(document.getElementById("status-text")?.textContent).toBe("Already pinned. You're all set.");
  });

  it("practice clicks in the illustration never claim the real pin state", async () => {
    await renderTour();
    next();
    next();
    await settle();
    (document.getElementById("puzzle") as HTMLButtonElement).click();
    (document.getElementById("pin-chrome") as HTMLButtonElement).click();
    expect(document.getElementById("pinned-icon")?.classList.contains("show")).toBe(true);
    expect(document.getElementById("status-text")?.textContent).toBe("Moat isn't pinned yet");
  });

  it("finishing marks onboarding seen and closes its own tab", async () => {
    const storage = await renderTour();
    next();
    next();
    next();
    next();
    await settle();
    expect((storage.uiState as { hasSeenOnboarding?: boolean }).hasSeenOnboarding).toBe(true);
    expect(removeTab).toHaveBeenCalledWith(7);
  });
});

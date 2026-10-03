// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ICONS_BELOW,
  DRAWER_BELOW,
  PREF_KEY,
  initNavMode,
  modeFor,
  readPreference,
} from "./navMode";

let current: { destroy: () => void } | null = null;
const labels = {
  collapse: "Collapse menu",
  expand: "Expand menu",
  open: "Menu",
  close: "Close menu",
};

function setup(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  document.body.className = "";
  delete document.body.dataset.nav;
  document.body.innerHTML = `
    <button id="nav-toggle"></button>
    <div id="nav-scrim" hidden></div>
    <nav id="dash-nav">
      <a href="#overview" data-page="overview" data-nav-link aria-current="page"><span class="nav-name">Overview</span></a>
      <a href="#about" data-page="about" data-nav-link><span class="nav-name">About Moat</span></a>
    </nav>`;
  current?.destroy();
  const nav = initNavMode(window, labels);
  current = nav;
  return {
    nav,
    toggle: document.getElementById("nav-toggle")!,
    scrim: document.getElementById("nav-scrim")!,
  };
}

describe("modeFor", () => {
  it("is a drawer on narrow windows, icons on medium, and the preference on wide", () => {
    expect(modeFor(390, "full")).toBe("drawer");
    expect(modeFor(DRAWER_BELOW, "full")).toBe("icons");
    expect(modeFor(1000, "full")).toBe("icons");
    expect(modeFor(ICONS_BELOW, "full")).toBe("full");
    expect(modeFor(1440, "icons")).toBe("icons");
  });
});

describe("readPreference", () => {
  it("defaults to full and survives storage that throws", () => {
    expect(readPreference(null)).toBe("full");
    expect(readPreference({ getItem: () => "icons" })).toBe("icons");
    expect(
      readPreference({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("full");
  });
});

describe("initNavMode", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    current?.destroy();
    current = null;
  });

  it("folds the full sidebar to icons and remembers it", () => {
    const { nav, toggle } = setup(1440);
    expect(nav.mode()).toBe("full");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse menu");
    toggle.click();
    expect(nav.mode()).toBe("icons");
    expect(document.body.dataset.nav).toBe("icons");
    expect(localStorage.getItem(PREF_KEY)).toBe("icons");
    expect(toggle.getAttribute("aria-label")).toBe("Expand menu");
  });

  it("labels the icon rail links with their names", () => {
    setup(1000);
    expect(
      document.querySelector<HTMLElement>('[data-page="about"]')!.dataset.tip,
    ).toBe("About Moat");
  });

  it("opens the drawer, closes it on Escape and returns focus to the button", () => {
    const { nav, toggle, scrim } = setup(390);
    expect(nav.mode()).toBe("drawer");
    toggle.click();
    expect(document.body.classList.contains("nav-open")).toBe(true);
    expect(scrim.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.classList.contains("nav-open")).toBe(false);
    expect(scrim.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it("closes the drawer when a screen is picked or the scrim is clicked", () => {
    const { toggle, scrim } = setup(390);
    toggle.click();
    document.querySelector<HTMLElement>('[data-page="about"]')!.click();
    expect(document.body.classList.contains("nav-open")).toBe(false);
    toggle.click();
    scrim.click();
    expect(document.body.classList.contains("nav-open")).toBe(false);
  });

  it("leaves drawer mode when the window grows", () => {
    const { nav, toggle } = setup(390);
    toggle.click();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    window.dispatchEvent(new Event("resize"));
    expect(nav.mode()).toBe("full");
    expect(document.body.classList.contains("nav-open")).toBe(false);
  });
  it("on a medium window, the button opens the full menu over the page", () => {
    const { nav, toggle, scrim } = setup(1000);
    expect(nav.mode()).toBe("icons");
    expect(toggle.getAttribute("aria-label")).toBe("Menu");
    toggle.click();
    expect(document.body.classList.contains("nav-open")).toBe(true);
    expect(scrim.hidden).toBe(false);
    expect(nav.mode()).toBe("icons");
    toggle.click();
    expect(document.body.classList.contains("nav-open")).toBe(false);
  });
});

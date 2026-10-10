// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTEXT, TOPICS, initHelpPanel } from "./helpPanel";

const t = (_key: string, fallback: string) => fallback;
let screen = "sites";
const report = vi.fn();

function setup() {
  document.body.className = "";
  document.body.innerHTML = `<button id="help-button" aria-expanded="false">Help</button>
    <aside id="help-panel" hidden><button class="hp-close">×</button><div class="hp-body"></div></aside>`;
  return initHelpPanel(document, { t, currentScreen: () => screen, report, docsUrl: "https://docs.example/", testPageUrl: "https://test.example/" });
}

beforeEach(() => {
  screen = "sites";
  report.mockClear();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
});

describe("help panel", () => {
  it("opens from the Help button with this screen's topic first", () => {
    const help = setup();
    document.getElementById("help-button")!.click();
    expect(help.isOpen()).toBe(true);
    expect(document.getElementById("help-button")!.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".hp-topic.here b")!.textContent).toBe("Page won't load");
    // The first topic isn't repeated in the lists below it.
    expect(Array.from(document.querySelectorAll(".hp-topic b"), (b) => b.textContent).filter((x) => x === "Page won't load")).toHaveLength(1);
  });

  it("plays a topic step by step and ticks the steps off", () => {
    setup().open();
    document.querySelector<HTMLButtonElement>(".hp-topic.here")!.click();
    expect(document.querySelector(".hp-cap")!.textContent).toBe("1/4Page stuck loading");
    const next = document.querySelectorAll<HTMLButtonElement>(".hp-nav")[1]!;
    next.click();
    expect(document.querySelector(".hp-cap")!.textContent).toBe("2/4Pause Moat on this site");
    expect(document.querySelectorAll(".hp-steps li.done")).toHaveLength(1);
    expect(document.querySelectorAll(".hp-scene.on")).toHaveLength(1);
    next.click();
    next.click();
    expect(next.textContent).toBe("Replay");
  });

  it("offers a problem report on fix topics", () => {
    setup().open();
    document.querySelector<HTMLButtonElement>(".hp-topic.here")!.click();
    document.querySelector<HTMLButtonElement>(".hp-still button")!.click();
    expect(report).toHaveBeenCalledOnce();
  });

  it("closes on Escape and gives focus back to the Help button", () => {
    const help = setup();
    help.open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(help.isOpen()).toBe(false);
    expect(document.activeElement).toBe(document.getElementById("help-button"));
  });

  it("has a first topic for every screen", () => {
    for (const id of Object.values(CONTEXT)) expect(TOPICS.some((x) => x.id === id)).toBe(true);
  });

  it("filters every topic by its words, steps included", () => {
    setup().open();
    const search = document.querySelector<HTMLInputElement>(".hp-search")!;
    search.value = "captcha";
    search.dispatchEvent(new Event("input"));
    expect(Array.from(document.querySelectorAll(".hp-topic b"), (b) => b.textContent)).toEqual(["Can't sign in"]);
    search.value = "reload page";
    search.dispatchEvent(new Event("input"));
    expect(Array.from(document.querySelectorAll(".hp-topic b"), (b) => b.textContent)).toEqual(["Page won't load", "Video won't play"]);
    search.value = "zzzz";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector(".hp-none")).not.toBeNull();
    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector(".hp-topic.here")).not.toBeNull();
  });

  it("opens a topic from a #help/<topic> link", () => {
    window.history.replaceState(null, "", "#help/danger");
    const help = setup();
    expect(help.isOpen()).toBe(true);
    expect(document.querySelector(".hp-title")!.textContent).toBe("Real site blocked");
    window.history.replaceState(null, "", "#help/nonsense");
    help.close();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(help.isOpen()).toBe(false);
    window.history.replaceState(null, "", "#");
  });
});

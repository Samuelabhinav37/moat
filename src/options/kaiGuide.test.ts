// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initKaiGuide, type KaiLine } from "./kaiGuide";

const t = (_key: string, fallback: string) => fallback;

function setup(screen = "overview", off = false) {
  const check = vi.fn();
  const turnOn = vi.fn();
  const openHelp = vi.fn();
  const lines: Record<string, KaiLine> = {
    overview: { say: ["kaiOverview", "Your week."], actions: [{ label: ["kaiCheckup", "Check my setup"], run: check }] },
    about: { say: ["kaiAbout", "What I send."], actions: [] },
  };
  const kai = initKaiGuide(document, { t, currentScreen: () => screen, isOff: () => off, turnOn, openHelp, lines });
  const button = document.querySelector<HTMLButtonElement>(".kai-button")!;
  const card = document.getElementById("kai-card")!;
  return { kai, button, card, check, turnOn, openHelp };
}

afterEach(() => document.body.replaceChildren());

describe("Kai's guide", () => {
  it("opens with the current screen's line and its actions, then All help", () => {
    const { button, card } = setup("overview");
    expect(card.hidden).toBe(true);
    button.click();
    expect(card.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector(".kai-say")!.textContent).toBe("Your week.");
    expect([...card.querySelectorAll(".kai-act")].map((b) => b.textContent)).toEqual(["Check my setup", "All help"]);
  });

  it("runs an action and closes", () => {
    const { button, card, check } = setup("overview");
    button.click();
    card.querySelector<HTMLButtonElement>(".kai-act")!.click();
    expect(check).toHaveBeenCalledOnce();
    expect(card.hidden).toBe(true);
  });

  it("leads with turning Moat on when protection is off", () => {
    const { button, card, turnOn } = setup("about", true);
    button.click();
    expect(card.querySelector(".kai-say")!.textContent).toContain("Moat is off");
    card.querySelector<HTMLButtonElement>(".kai-act.primary")!.click();
    expect(turnOn).toHaveBeenCalledOnce();
  });

  it("falls back to the Overview line on an unknown screen, and closes on Escape", () => {
    const { button, card } = setup("nowhere");
    button.click();
    expect(card.querySelector(".kai-say")!.textContent).toBe("Your week.");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(card.hidden).toBe(true);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initKaiGuide, type KaiQuestion } from "./kaiGuide";

const t = (_key: string, fallback: string) => fallback;

function setup(screen = "overview", off = false) {
  const turnOn = vi.fn();
  const openHelp = vi.fn();
  const help = vi.fn();
  document.body.innerHTML = '<div id="pause-box">pause here</div>';
  const questions: KaiQuestion[] = [
    { id: "level", ask: ["a", "Where do I change the level?"], answer: ["b", "Protection, then Level."], hash: "#blocking" },
    { id: "pause", ask: ["c", "How do I pause a site?"], answer: ["d", "Exceptions, then Paused."], hash: "#paused", target: "#pause-box" },
    { id: "broken", ask: ["e", "Something's broken"], answer: ["f", "Let's fix it."], run: help },
  ];
  const kai = initKaiGuide(document, { t, currentScreen: () => screen, isOff: () => off, turnOn, openHelp, questions, firstOn: { exceptions: ["pause"] } });
  const button = document.querySelector<HTMLButtonElement>(".kai-button")!;
  const card = document.getElementById("kai-card")!;
  const asks = () => [...card.querySelectorAll(".kai-q")].map((b) => b.textContent);
  return { kai, button, card, asks, turnOn, openHelp, help };
}

afterEach(() => {
  document.body.replaceChildren();
  location.hash = "";
});

describe("Kai's guide", () => {
  it("lists the questions, this screen's first, then All help", () => {
    const { button, asks } = setup("exceptions");
    button.click();
    expect(asks()).toEqual(["How do I pause a site?", "Where do I change the level?", "Something's broken", "All help"]);
  });

  it("answers a question and takes you there", async () => {
    vi.useFakeTimers();
    const { button, card } = setup();
    button.click();
    [...card.querySelectorAll<HTMLButtonElement>(".kai-q")].find((b) => b.textContent === "How do I pause a site?")!.click();
    expect(card.querySelector(".kai-say")!.textContent).toBe("Exceptions, then Paused.");
    expect(location.hash).toBe("#paused");
    vi.advanceTimersByTime(300);
    expect(document.getElementById("pause-box")!.classList.contains("kai-here")).toBe(true);
    expect(card.hidden).toBe(false);
    vi.useRealTimers();
  });

  it("runs a question that opens help, and closes", () => {
    const { button, card, help } = setup();
    button.click();
    [...card.querySelectorAll<HTMLButtonElement>(".kai-q")].find((b) => b.textContent === "Something's broken")!.click();
    expect(help).toHaveBeenCalledOnce();
    expect(card.hidden).toBe(true);
  });

  it("offers to turn Moat on when it's off, and closes on Escape", () => {
    const { button, card, turnOn } = setup("about", true);
    button.click();
    expect(card.querySelector(".kai-say")!.textContent).toContain("Moat is off");
    card.querySelector<HTMLButtonElement>(".kai-q.primary")!.click();
    expect(turnOn).toHaveBeenCalledOnce();
    button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(card.hidden).toBe(true);
  });
});

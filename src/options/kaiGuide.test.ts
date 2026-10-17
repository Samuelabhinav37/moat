// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initKaiGuide, type KaiQuestion } from "./kaiGuide";

const t = (_key: string, fallback: string) => fallback;

function setup(screen = "overview", off = false) {
  const turnOn = vi.fn();
  const openHelp = vi.fn();
  const help = vi.fn();
  document.body.innerHTML = '<div id="pause-box">pause here</div><a data-nav-link data-page="exceptions"><span class="nav-name">Exceptions</span></a>';
  const questions: KaiQuestion[] = [
    { id: "level", ask: ["a", "Where do I change the level?"], answer: ["b", "Protection, then Level."], hash: "#blocking" },
    { id: "pause", ask: ["c", "How do I pause a site?"], answer: ["d", "Exceptions, then Paused."], hash: "#paused", target: "#pause-box" },
    { id: "broken", ask: ["e", "Something's broken"], answer: ["f", "Let's fix it."], run: help },
    { id: "data", ask: ["g", "Does Moat collect my data?"], answer: ["h", "No."] },
    { id: "backup", ask: ["i", "How do I back up?"], answer: ["j", "Backup and sync."], hash: "#backup" },
  ];
  const kai = initKaiGuide(document, { t, currentScreen: () => screen, isOff: () => off, turnOn, openHelp, questions, firstOn: { exceptions: ["pause"] } });
  const button = document.querySelector<HTMLButtonElement>(".kai-button")!;
  const panel = document.getElementById("kai-card")!;
  const chips = () => [...panel.querySelectorAll(".kai-q")].map((b) => b.textContent);
  const chip = (text: string) => [...panel.querySelectorAll<HTMLButtonElement>(".kai-q")].find((b) => b.textContent === text)!;
  const said = () => [...panel.querySelectorAll(".kg-msg.kg-kai:not(.typing)")].map((m) => m.firstChild?.textContent ?? "");
  // Open, and let Kai finish typing its greeting.
  const open = () => { button.click(); vi.advanceTimersByTime(2000); };
  return { kai, button, panel, chips, chip, said, open, turnOn, openHelp, help };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
  document.body.replaceChildren();
  location.hash = "";
});

describe("Kai's guide", () => {
  it("puts the live Kai in the corner with Ask Kai above it", () => {
    const { button } = setup();
    expect(document.querySelector(".kg-tag")!.textContent).toBe("Ask Kai");
    expect(button.querySelector(".kai .kai-body")).not.toBeNull();
    expect(button.querySelector(".kai .kai-ant")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Ask Kai");
  });

  it("says hello once per visit, then Ask Kai, then folds the bubble away", () => {
    setup();
    const tag = document.querySelector(".kg-tag")!;
    const guide = document.querySelector(".kai-guide")!;
    vi.advanceTimersByTime(800);
    expect(tag.textContent).toBe("Hi, I'm Kai. I'm small, but I know Moat inside out.");
    expect(guide.classList.contains("tag-on")).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(tag.textContent).toBe("Ask Kai");
    expect(guide.classList.contains("tag-on")).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(guide.classList.contains("tag-on")).toBe(false);
    // Settings opened again in the same visit: no second hello
    document.body.replaceChildren();
    setup();
    vi.advanceTimersByTime(2000);
    expect(document.querySelector(".kai-guide")!.classList.contains("tag-on")).toBe(false);
  });

  it("comes back only when you look stuck: a rage click", () => {
    const { kai } = setup();
    const guide = document.querySelector(".kai-guide")!;
    const tag = document.querySelector(".kg-tag")!;
    vi.advanceTimersByTime(13000);
    expect(guide.classList.contains("tag-on")).toBe(false);
    // (the watcher only counts the person's own clicks; the e2e covers real
    // ones, .cache/opt/field/kai-bubble-e2e.mjs)
    const click = () => kai.watch!.click(50, 50);
    click(); vi.advanceTimersByTime(150); click(); vi.advanceTimersByTime(150); click();
    expect(guide.classList.contains("tag-on")).toBe(true);
    expect(tag.textContent).toBe("Hmm. Want me to take a look?");
    vi.advanceTimersByTime(7100);
    expect(guide.classList.contains("tag-on")).toBe(false);
  });

  it("names the screen when a switch keeps flipping, and never nudges while the chat is open", () => {
    const { open, button, kai } = setup("exceptions");
    vi.advanceTimersByTime(13000);
    const flip = () => kai.watch!.flip("opt");
    open();
    flip(); flip(); flip();
    const guide = document.querySelector(".kai-guide")!;
    expect(guide.classList.contains("tag-on")).toBe(false);
    button.click();
    vi.advanceTimersByTime(500);
    flip(); flip(); flip();
    // opening the chat makes Kai twice as patient, but this is the first nudge
    expect(guide.classList.contains("tag-on")).toBe(true);
    expect(document.querySelector(".kg-tag")!.textContent).toBe("Need a hand with Exceptions?");
  });

  it("greets, then lists four questions with this screen's first, more, and All help", () => {
    const { open, said, chips, button } = setup("exceptions");
    open();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(said()).toEqual(["Hi, I'm Kai. What are you looking for?"]);
    expect(chips()).toEqual(["How do I pause a site?", "Where do I change the level?", "Something's broken", "Does Moat collect my data?", "Ask something else", "All help"]);
  });

  it("lists the rest under Ask something else", () => {
    const { open, chip, chips } = setup();
    open();
    chip("Ask something else").click();
    expect(chips()).toEqual(["How do I back up?", "All help"]);
  });

  it("answers after thinking, then Show me takes you there", () => {
    const { open, chip, said, panel } = setup();
    open();
    chip("How do I pause a site?").click();
    expect(panel.querySelector(".kg-msg.kg-me")!.textContent).toBe("How do I pause a site?");
    expect(panel.querySelector(".kg-msg.typing")).not.toBeNull();
    expect(document.querySelector(".kai-guide")!.classList.contains("thinking")).toBe(true);
    expect(panel.querySelector(".kg-status")!.textContent).toBe("Thinking");
    vi.advanceTimersByTime(2000);
    expect(panel.querySelector(".kg-msg.typing")).toBeNull();
    expect(said().at(-1)).toBe("Exceptions, then Paused.");
    // a message must never carry the engine's .kai class (it would take Kai's size)
    expect(panel.querySelectorAll(".kg-msg.kai")).toHaveLength(0);
    expect(panel.querySelector(".kg-status")!.textContent).toBe("Here to help with Moat");
    const show = panel.querySelector<HTMLButtonElement>(".kg-go")!;
    expect(show.textContent).toBe("Show me →");
    show.click();
    expect(location.hash).toBe("#paused");
    expect(panel.hidden).toBe(true);
    // Kai looks at the spot first, then the ring appears
    vi.advanceTimersByTime(300);
    expect(document.getElementById("pause-box")!.classList.contains("kai-here")).toBe(false);
    vi.advanceTimersByTime(700);
    expect(document.getElementById("pause-box")!.classList.contains("kai-here")).toBe(true);
  });

  it("offers three unasked follow-ups after an answer", () => {
    const { open, chip, chips } = setup();
    open();
    chip("Does Moat collect my data?").click();
    vi.advanceTimersByTime(2000);
    expect(chips()).toEqual(["Where do I change the level?", "How do I pause a site?", "Something's broken", "Ask something else"]);
  });

  it("starts a help topic from Start, and closes", () => {
    const { open, chip, panel, help } = setup();
    open();
    chip("Something's broken").click();
    vi.advanceTimersByTime(2000);
    const start = panel.querySelector<HTMLButtonElement>(".kg-go")!;
    expect(start.textContent).toBe("Start →");
    start.click();
    expect(help).toHaveBeenCalledOnce();
    expect(panel.hidden).toBe(true);
  });

  it("says Moat is off first and offers to turn it on; Escape closes", () => {
    const { open, panel, said, turnOn, button } = setup("about", true);
    open();
    expect(said()[0]).toContain("Moat is off");
    panel.querySelector<HTMLButtonElement>(".kg-go")!.click();
    expect(turnOn).toHaveBeenCalledOnce();
    open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("All help opens Help and closes", () => {
    const { open, chip, openHelp, panel } = setup();
    open();
    chip("All help").click();
    expect(openHelp).toHaveBeenCalledOnce();
    expect(panel.hidden).toBe(true);
  });

  it("closes on a click elsewhere, not on its own buttons", () => {
    const { open, chip, panel } = setup();
    open();
    chip("Ask something else").click();
    expect(panel.hidden).toBe(false);
    document.getElementById("pause-box")!.click();
    expect(panel.hidden).toBe(true);
  });
  it("says Welcome back on a later day, and nothing the same day", () => {
    setup();
    vi.advanceTimersByTime(9000);
    document.body.replaceChildren();
    sessionStorage.clear();
    setup();
    vi.advanceTimersByTime(1000);
    expect(document.querySelector(".kai-guide")!.classList.contains("tag-on")).toBe(false);
    document.body.replaceChildren();
    sessionStorage.clear();
    vi.setSystemTime(Date.now() + 21 * 3600000);
    setup();
    vi.advanceTimersByTime(1000);
    expect(document.querySelector(".kg-tag")!.textContent).toBe("Welcome back.");
  });

  it("greets with the off line when Moat is off", () => {
    setup("overview", true);
    vi.advanceTimersByTime(800);
    expect(document.querySelector(".kg-tag")!.textContent).toBe("Heads up. Moat is off, so ads and trackers are getting through.");
  });

  it("reacts when protection goes off and back on, but not to the first state", () => {
    const { kai } = setup();
    vi.advanceTimersByTime(9000);
    const tag = () => document.querySelector(".kg-tag")!.textContent;
    const on = () => document.querySelector(".kai-guide")!.classList.contains("tag-on");
    kai.protection(false);
    expect(on()).toBe(false);
    kai.protection(true);
    vi.advanceTimersByTime(10);
    expect(tag()).toBe("Heads up. Moat is off, so ads and trackers are getting through.");
    vi.advanceTimersByTime(4000);
    kai.protection(false);
    vi.advanceTimersByTime(600);
    expect(tag()).toBe("Back on guard.");
    vi.advanceTimersByTime(4000);
    kai.moment({ name: "paused" });
    vi.advanceTimersByTime(10);
    expect(tag()).toBe("Paused. I'll look away there.");
    vi.advanceTimersByTime(4000);
    kai.moment({ name: "milestone", count: 1000 });
    vi.advanceTimersByTime(10);
    expect(tag()).toBe(`That's ${(1000).toLocaleString()} blocked this week.`);
  });

  // Runs 16 minutes of Kai's timers: about a second alone, past vitest's 5s
  // default under a loaded full run.
  it("keeps the conversation when reopened within 10 minutes", { timeout: 20_000 }, () => {
    const { open, button, chip, said } = setup();
    open();
    chip("Does Moat collect my data?").click();
    vi.advanceTimersByTime(2000);
    const before = said();
    button.click();
    vi.advanceTimersByTime(5 * 60000);
    open();
    expect(said()).toEqual(before);
    button.click();
    vi.advanceTimersByTime(11 * 60000);
    open();
    expect(said()).toEqual(["Hi, I'm Kai. What are you looking for?"]);
  });
});

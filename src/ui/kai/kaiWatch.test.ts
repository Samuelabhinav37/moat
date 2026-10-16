// kaiWatch.js decides when the bubble above Kai shows. These feed it
// signals by hand (no window), with fake time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./kaiWatch.js";
import type { KaiWatchOptions } from "./kaiWatch";

type Shown = [kind: string, text: string];

function setup(extra: Partial<KaiWatchOptions> = {}) {
  const shown: Shown[] = [];
  let open = false;
  const w = globalThis.window ? window.KaiWatch : (globalThis as unknown as { KaiWatch: Window["KaiWatch"] }).KaiWatch;
  const watch = w({ show: (k, t) => shown.push([k, t]), isOpen: () => open, ...extra });
  return { watch, shown, setOpen: (v: boolean) => { open = v; } };
}
const tick = (ms: number) => vi.advanceTimersByTime(ms);
const flip3 = (watch: ReturnType<typeof setup>["watch"], key: string) => { watch.flip(key); watch.flip(key); watch.flip(key); };

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

describe("kaiWatch", () => {
  it("welcomes once, then folds after 8 seconds without counting as ignored", () => {
    const { watch, shown } = setup();
    expect(watch.welcome()).toBe(true);
    expect(watch.welcome()).toBe(false);
    tick(7999);
    expect(watch.isShowing()).toBe("welcome");
    tick(2);
    expect(watch.isShowing()).toBeNull();
    expect(shown).toEqual([["welcome", "Ask Kai"]]);
    expect(watch.state().ignored).toBe(0);
  });

  it("calls three quick clicks on one spot stuck, but not slow or spread-out clicks", () => {
    const { watch, shown } = setup();
    tick(13000);
    watch.click(100, 100); tick(600); watch.click(100, 100); tick(600); watch.click(100, 100);
    tick(1100);
    watch.click(100, 100); tick(100); watch.click(300, 100); tick(100); watch.click(500, 100);
    expect(shown).toEqual([]);
    tick(1100);
    watch.click(100, 100); tick(200); watch.click(105, 102); tick(200); watch.click(101, 99);
    expect(shown.at(-1)?.[0]).toBe("stuck");
  });

  it("waits out the first seconds, then shows the nudge", () => {
    const { watch, shown } = setup();
    watch.welcome();
    tick(1000);
    watch.click(10, 10); watch.click(10, 10); watch.click(10, 10);
    expect(shown.length).toBe(1);
    tick(11500);
    expect(shown.at(-1)?.[0]).toBe("stuck");
  });

  it("keeps to one nudge per screen, a minute apart, and goes quiet after two are ignored", () => {
    const { watch, shown } = setup();
    tick(13000);
    watch.section("a");
    flip3(watch, "x");
    expect(shown.length).toBe(1);
    tick(7001);
    expect(watch.state().ignored).toBe(1);
    tick(60000);
    flip3(watch, "x");
    expect(shown.length).toBe(1);
    watch.section("b");
    flip3(watch, "y");
    expect(shown.length).toBe(2);
    tick(7001);
    tick(61000);
    watch.section("c");
    flip3(watch, "z");
    expect(shown.length).toBe(2);
  });

  it("never nudges while the chat is open or you type; after opening it waits twice as long", () => {
    const { watch, shown, setOpen } = setup();
    tick(13000);
    setOpen(true); flip3(watch, "a");
    setOpen(false); watch.key(); flip3(watch, "b");
    expect(shown.length).toBe(0);
    tick(3001); flip3(watch, "c");
    expect(shown.length).toBe(1);
    watch.opened();
    tick(61000); watch.section("s2"); flip3(watch, "d");
    expect(shown.length).toBe(1);
    tick(60000); flip3(watch, "e");
    expect(shown.length).toBe(2);
  });

  it("notices going back and forth between two screens, and hopping through many", () => {
    const one = setup();
    tick(13000);
    one.watch.section("a"); tick(2000); one.watch.section("b"); tick(2000); one.watch.section("a"); tick(2000); one.watch.section("b");
    expect(one.shown.at(-1)?.[0]).toBe("looking");
    const two = setup();
    const t0 = Date.now();
    ["/", "/a", "/b", "/c"].forEach((p, i) => two.watch.section(p, t0 - 20000 + i * 5000));
    two.watch.section("/d");
    expect(two.shown.length).toBe(0);
    tick(12100);
    expect(two.shown.at(-1)?.[0]).toBe("looking");
  });

  it("notices scrolling up and down without clicking, and names the screen", () => {
    const { watch, shown } = setup({ sectionName: (id) => (id === "sort" ? "Sorting" : "") });
    tick(13000);
    watch.section("sort");
    let y = 0;
    watch.scroll(0);
    for (let i = 0; i < 5; i++) { for (let j = 0; j < 3; j++) { y += i % 2 ? -100 : 100; watch.scroll(y); } tick(1000); }
    expect(shown.at(-1)).toEqual(["looking", "Need help with Sorting?"]);
  });

  it("forgets the hunting once you click", () => {
    const { watch, shown } = setup();
    tick(13000);
    let y = 0;
    watch.scroll(0);
    for (let i = 0; i < 6; i++) { for (let j = 0; j < 3; j++) { y += i % 2 ? -100 : 100; watch.scroll(y); } if (i === 2) watch.click(5, 5); tick(1000); }
    expect(shown).toEqual([]);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSavedToast, INTERACTION_WINDOW_MS, shouldConfirm, TOAST_MS } from "./savedToast";

describe("shouldConfirm", () => {
  it("confirms only a change that follows something the person did on the page", () => {
    expect(shouldConfirm(10_000, 9_000)).toBe(true);
    expect(shouldConfirm(10_000, 10_000 - INTERACTION_WINDOW_MS)).toBe(false);
    expect(shouldConfirm(10_000, -Infinity)).toBe(false);
  });
});

describe("createSavedToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="t" hidden><span id="l"></span></div><button id="b"></button>';
  });
  afterEach(() => vi.useRealTimers());

  const make = () => createSavedToast(document.getElementById("t")!, document.getElementById("l")!);

  it("stays quiet for a change nobody on this page made", () => {
    const toast = make();
    toast.settingsChanged("Saved");
    expect(document.getElementById("t")!.hidden).toBe(true);
  });

  it("shows after a click, then hides again", () => {
    const toast = make();
    document.getElementById("b")!.click();
    toast.settingsChanged("Saved");
    const el = document.getElementById("t")!;
    expect(el.hidden).toBe(false);
    expect(document.getElementById("l")!.textContent).toBe("Saved");
    vi.advanceTimersByTime(TOAST_MS);
    expect(el.hidden).toBe(true);
  });
});

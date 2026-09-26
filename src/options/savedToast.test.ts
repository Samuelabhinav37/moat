// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSavedToast, INTERACTION_WINDOW_MS, shouldConfirm, TOAST_MS, UNDO_MS } from "./savedToast";

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

describe("offerUndo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="t" hidden><span id="l"></span><button id="a" hidden></button></div><button id="b"></button>';
  });
  afterEach(() => vi.useRealTimers());

  const make = () =>
    createSavedToast(document.getElementById("t")!, document.getElementById("l")!, document.getElementById("a") as HTMLButtonElement);

  it("shows the message with an Undo button that runs the restore once", () => {
    const toast = make();
    let restored = 0;
    toast.offerUndo("Resumed reddit.com", "Undo", () => restored++);
    const action = document.getElementById("a") as HTMLButtonElement;
    expect(document.getElementById("l")!.textContent).toBe("Resumed reddit.com");
    expect(action.hidden).toBe(false);
    action.click();
    action.click();
    expect(restored).toBe(1);
    expect(document.getElementById("t")!.hidden).toBe(true);
  });

  it("isn't replaced by the removal's own Saved, and stays long enough to use", () => {
    const toast = make();
    document.getElementById("b")!.click();
    toast.offerUndo("Removed x.example", "Undo", () => {});
    toast.settingsChanged("Saved");
    expect(document.getElementById("l")!.textContent).toBe("Removed x.example");
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(document.getElementById("t")!.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(document.getElementById("t")!.hidden).toBe(true);
  });
});

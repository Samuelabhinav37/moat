import { afterEach, describe, expect, it, vi } from "vitest";
import { readPinState, watchPinState, type ActionLike } from "./pinState";

afterEach(() => vi.useRealTimers());

describe("readPinState", () => {
  it("reads isOnToolbar", async () => {
    expect(await readPinState({ getUserSettings: async () => ({ isOnToolbar: true }) })).toBe("pinned");
    expect(await readPinState({ getUserSettings: async () => ({ isOnToolbar: false }) })).toBe("unpinned");
  });

  it("is unknown when the browser can't say", async () => {
    expect(await readPinState(undefined)).toBe("unknown");
    expect(await readPinState({})).toBe("unknown");
    expect(await readPinState({ getUserSettings: async () => ({}) })).toBe("unknown");
    expect(await readPinState({ getUserSettings: () => Promise.reject(new Error("no")) })).toBe("unknown");
  });
});

describe("watchPinState", () => {
  it("uses onUserSettingsChanged when it exists, and stops cleanly", async () => {
    let listener: ((change: { isOnToolbar?: boolean }) => void) | undefined;
    const removeListener = vi.fn();
    const action: ActionLike = {
      getUserSettings: async () => ({ isOnToolbar: false }),
      onUserSettingsChanged: { addListener: (l) => (listener = l), removeListener },
    };
    const seen: string[] = [];
    const stop = watchPinState(action, (s) => seen.push(s));
    await Promise.resolve();
    await Promise.resolve();
    listener!({ isOnToolbar: true });
    expect(seen).toEqual(["unpinned", "pinned"]);
    stop();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });

  it("polls when there's no change event, reporting only changes", async () => {
    vi.useFakeTimers();
    let pinned = false;
    const action: ActionLike = { getUserSettings: async () => ({ isOnToolbar: pinned }) };
    const seen: string[] = [];
    const stop = watchPinState(action, (s) => seen.push(s), 1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    pinned = true;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual(["unpinned", "pinned"]);
    stop();
  });
});

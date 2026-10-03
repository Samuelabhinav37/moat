import { describe, expect, it } from "vitest";
import { pauseEnd, pauseEndLabel } from "./pauseDuration";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe("pauseEnd", () => {
  it("adds an hour or a day, and has no end for a lasting pause", () => {
    expect(pauseEnd("hour", 1_000)).toBe(1_000 + 3_600_000);
    expect(pauseEnd("day", 1_000)).toBe(1_000 + 86_400_000);
    expect(pauseEnd("always", 1_000)).toBeUndefined();
  });
});

describe("pauseEndLabel", () => {
  const now = at(2026, 10, 2, 22, 30); // a Friday evening
  it("shows only the time when it ends today", () => {
    expect(pauseEndLabel(at(2026, 10, 2, 23, 30), now, "tomorrow", "en-US")).toBe("11:30 PM");
  });
  it("says tomorrow when it ends tomorrow", () => {
    expect(pauseEndLabel(at(2026, 10, 3, 22, 30), now, "tomorrow", "en-US")).toBe("tomorrow 10:30 PM");
  });
  it("names the day when it's further off", () => {
    expect(pauseEndLabel(at(2026, 10, 5, 9, 0), now, "tomorrow", "en-US")).toBe("Mon 9:00 AM");
  });
});

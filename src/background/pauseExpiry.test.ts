import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));
vi.mock("./settings", () => ({ endExpiredPauses: async () => 0 }));

const { nextPauseEnd } = await import("./pauseExpiry");

describe("nextPauseEnd", () => {
  it("is the earliest end among sites still paused", () => {
    expect(nextPauseEnd({ disabledSites: ["a.example", "b.example", "c.example"], pausedUntil: { "a.example": 9, "b.example": 4 } })).toBe(4);
  });

  it("ignores ends left over for sites no longer paused, and lasting pauses", () => {
    expect(nextPauseEnd({ disabledSites: ["c.example"], pausedUntil: { "a.example": 4 } })).toBeNull();
  });
});

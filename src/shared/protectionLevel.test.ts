import { describe, expect, it } from "vitest";
import { PROTECTION_LEVEL_MESSAGE_KEY, protectionLevelForCount } from "./protectionLevel";

describe("protectionLevelForCount", () => {
  it("returns none for zero or negative counts", () => {
    expect(protectionLevelForCount(0)).toBe("none");
    expect(protectionLevelForCount(-1)).toBe("none");
  });

  it("returns light for a small count", () => {
    expect(protectionLevelForCount(1)).toBe("light");
    expect(protectionLevelForCount(4)).toBe("light");
  });

  it("returns moderate for a mid-range count", () => {
    expect(protectionLevelForCount(5)).toBe("moderate");
    expect(protectionLevelForCount(14)).toBe("moderate");
  });

  it("returns heavy for a large count", () => {
    expect(protectionLevelForCount(15)).toBe("heavy");
    expect(protectionLevelForCount(500)).toBe("heavy");
  });
});

describe("PROTECTION_LEVEL_MESSAGE_KEY", () => {
  it("has a message key for every possible level", () => {
    for (const count of [0, 2, 10, 100]) {
      const level = protectionLevelForCount(count);
      expect(PROTECTION_LEVEL_MESSAGE_KEY[level]).toBeTruthy();
    }
  });
});

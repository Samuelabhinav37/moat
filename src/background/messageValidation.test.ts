import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_STRING_LENGTH,
  MAX_RULE_MATCH_HITS,
  MAX_USAGE_SIGNAL_COUNT,
  clampUsageSignalCount,
  isHostnameSelectorHits,
  isValidMessageString,
} from "./messageValidation";

describe("isValidMessageString", () => {
  it("accepts an ordinary non-empty string", () => {
    expect(isValidMessageString("example.com")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidMessageString("")).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(isValidMessageString(123)).toBe(false);
    expect(isValidMessageString(null)).toBe(false);
    expect(isValidMessageString(undefined)).toBe(false);
    expect(isValidMessageString({})).toBe(false);
  });

  it("accepts a string exactly at MAX_MESSAGE_STRING_LENGTH", () => {
    expect(isValidMessageString("a".repeat(MAX_MESSAGE_STRING_LENGTH))).toBe(true);
  });

  it("rejects a string one character over MAX_MESSAGE_STRING_LENGTH", () => {
    expect(isValidMessageString("a".repeat(MAX_MESSAGE_STRING_LENGTH + 1))).toBe(false);
  });
});

describe("isHostnameSelectorHits", () => {
  it("accepts an empty array", () => {
    expect(isHostnameSelectorHits([])).toBe(true);
  });

  it("accepts a well-formed array of hostname/selector pairs", () => {
    expect(isHostnameSelectorHits([{ hostname: "example.com", selector: ".ad" }])).toBe(true);
  });

  it("rejects a non-array value", () => {
    expect(isHostnameSelectorHits("not-an-array")).toBe(false);
    expect(isHostnameSelectorHits(null)).toBe(false);
    expect(isHostnameSelectorHits({})).toBe(false);
  });

  it("rejects an array longer than MAX_RULE_MATCH_HITS", () => {
    const items = Array.from({ length: MAX_RULE_MATCH_HITS + 1 }, () => ({ hostname: "a.com", selector: ".x" }));
    expect(isHostnameSelectorHits(items)).toBe(false);
  });

  it("accepts an array exactly at MAX_RULE_MATCH_HITS", () => {
    const items = Array.from({ length: MAX_RULE_MATCH_HITS }, () => ({ hostname: "a.com", selector: ".x" }));
    expect(isHostnameSelectorHits(items)).toBe(true);
  });

  it("rejects an item missing hostname or selector", () => {
    expect(isHostnameSelectorHits([{ hostname: "a.com" }])).toBe(false);
    expect(isHostnameSelectorHits([{ selector: ".x" }])).toBe(false);
  });

  it("rejects an item whose hostname or selector isn't a valid message string", () => {
    expect(isHostnameSelectorHits([{ hostname: "", selector: ".x" }])).toBe(false);
    expect(isHostnameSelectorHits([{ hostname: "a.com", selector: 123 }])).toBe(false);
  });

  it("rejects a null or non-object item inside an otherwise well-formed array", () => {
    expect(isHostnameSelectorHits([null])).toBe(false);
    expect(isHostnameSelectorHits(["a.com"])).toBe(false);
  });

  it("rejects the whole array if just one item among many is malformed", () => {
    const items = [{ hostname: "a.com", selector: ".x" }, { hostname: "b.com" /* missing selector */ }];
    expect(isHostnameSelectorHits(items)).toBe(false);
  });
});

describe("clampUsageSignalCount", () => {
  it("passes through an ordinary positive count", () => {
    expect(clampUsageSignalCount(5)).toBe(5);
  });

  it("falls back to 1 for a non-number value", () => {
    expect(clampUsageSignalCount("5")).toBe(1);
    expect(clampUsageSignalCount(null)).toBe(1);
    expect(clampUsageSignalCount(undefined)).toBe(1);
  });

  it("falls back to 1 for zero or a negative count", () => {
    expect(clampUsageSignalCount(0)).toBe(1);
    expect(clampUsageSignalCount(-5)).toBe(1);
  });

  it("falls back to 1 for a count over MAX_USAGE_SIGNAL_COUNT, rather than clamping to the cap", () => {
    // Matches the actual production behavior at background/index.ts's
    // "record-usage-signal" case: an out-of-range value is treated as
    // untrustworthy entirely, not silently capped to the max.
    expect(clampUsageSignalCount(MAX_USAGE_SIGNAL_COUNT + 1)).toBe(1);
    expect(clampUsageSignalCount(1_000_000)).toBe(1);
  });

  it("accepts a count exactly at MAX_USAGE_SIGNAL_COUNT", () => {
    expect(clampUsageSignalCount(MAX_USAGE_SIGNAL_COUNT)).toBe(MAX_USAGE_SIGNAL_COUNT);
  });

  it("falls back to 1 for NaN", () => {
    expect(clampUsageSignalCount(NaN)).toBe(1);
  });
});

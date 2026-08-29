import { describe, expect, it } from "vitest";
import { isSafeCosmeticSelector, MAX_SELECTOR_LENGTH } from "./selectorSafety";

describe("isSafeCosmeticSelector", () => {
  it("accepts ordinary selectors", () => {
    expect(isSafeCosmeticSelector(".ad-slot")).toBe(true);
    expect(isSafeCosmeticSelector("#sidebar > div.promo:nth-child(2)")).toBe(true);
    expect(isSafeCosmeticSelector('[data-testid="sponsored"]')).toBe(true);
  });

  it("accepts native :has() / :is() with an internal comma", () => {
    expect(isSafeCosmeticSelector("div:has(a[href], img)")).toBe(true);
    expect(isSafeCosmeticSelector(":is(.a, .b) .c")).toBe(true);
  });

  it("rejects characters that could break out of the wrapping { } block", () => {
    expect(isSafeCosmeticSelector(".ad} body { display:none")).toBe(false);
    expect(isSafeCosmeticSelector(".ad { color:red }")).toBe(false);
    expect(isSafeCosmeticSelector(".ad<style>")).toBe(false);
    expect(isSafeCosmeticSelector(".ad`x`")).toBe(false);
  });

  it("rejects empty and over-length input", () => {
    expect(isSafeCosmeticSelector("")).toBe(false);
    expect(isSafeCosmeticSelector("a".repeat(MAX_SELECTOR_LENGTH))).toBe(true);
    expect(isSafeCosmeticSelector("a".repeat(MAX_SELECTOR_LENGTH + 1))).toBe(false);
  });
});

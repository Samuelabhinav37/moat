// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTheme, resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("uses a picked theme as is", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("follows the device for System, or when nothing was picked", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme(null, false)).toBe("dark");
    expect(resolveTheme("nonsense", true)).toBe("light");
  });
});

describe("applyTheme", () => {
  it("sets data-theme on <html>", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

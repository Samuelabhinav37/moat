import { describe, expect, it } from "vitest";
import { isProceduralSelector, parseProceduralSelector } from "./parseProceduralSelector.mjs";

describe("isProceduralSelector", () => {
  it("is true for a supported extended pseudo", () => {
    expect(isProceduralSelector(".a:has-text(x)")).toBe(true);
    expect(isProceduralSelector(".a:upward(2)")).toBe(true);
    expect(isProceduralSelector(":xpath(//a)")).toBe(true);
  });
  it("is false for plain CSS (including native :has/:not)", () => {
    expect(isProceduralSelector(".a > .b:not(.c)")).toBe(false);
    expect(isProceduralSelector(".a:has(.b)")).toBe(false);
  });
});

describe("parseProceduralSelector", () => {
  it("splits the CSS prefix from the task chain", () => {
    expect(parseProceduralSelector(".item:has-text(Sponsored):upward(2)")).toEqual({
      s: ".item",
      t: [["has-text", "Sponsored"], ["upward", 2]],
      x: ".item:has-text(Sponsored):upward(2)",
    });
  });

  it("handles a bare :xpath() with no prefix", () => {
    expect(parseProceduralSelector(':xpath(//div[@id="ad"])')).toEqual({
      s: "",
      t: [["xpath", '//div[@id="ad"]']],
      x: ':xpath(//div[@id="ad"])',
    });
  });

  it("keeps a /regex/ argument to :has-text verbatim", () => {
    expect(parseProceduralSelector(".b:has-text(/spon(sored)?/i)").t).toEqual([["has-text", "/spon(sored)?/i"]]);
  });

  it("distinguishes :upward(n) from :upward(selector)", () => {
    expect(parseProceduralSelector(".c:upward(3)").t).toEqual([["upward", 3]]);
    expect(parseProceduralSelector(".c:upward(.wrap)").t).toEqual([["upward-sel", ".wrap"]]);
  });

  it("records :remove() as a terminal action, dropping it from the task list", () => {
    expect(parseProceduralSelector(".d:min-text-length(40):remove()")).toEqual({
      s: ".d",
      t: [["min-text-length", 40]],
      r: 1,
      x: ".d:min-text-length(40):remove()",
    });
  });

  it("allows a bare selector:remove()", () => {
    expect(parseProceduralSelector(".ad:remove()")).toEqual({ s: ".ad", t: [], r: 1, x: ".ad:remove()" });
  });

  it("carries the pseudo variant on :matches-css-before / -after", () => {
    expect(parseProceduralSelector(".e:matches-css-before(content: /ad/)").t).toEqual([
      ["matches-css", "before", "content: /ad/"],
    ]);
  });

  it("returns null for an unsupported task in the chain", () => {
    expect(parseProceduralSelector(".f:has-text(x):matches-attr(foo)")).toBeNull();
  });

  it("returns null when :remove() is not terminal", () => {
    expect(parseProceduralSelector(".g:remove():has-text(x)")).toBeNull();
  });

  it("returns null for a ^-prefixed HTML-filtering selector", () => {
    expect(parseProceduralSelector("^script:has-text(adblock)")).toBeNull();
  });

  it("returns null for an unsafe prefix (contains a brace)", () => {
    expect(parseProceduralSelector(".a}{x}:has-text(y)")).toBeNull();
  });

  it("returns null for a plain selector with no procedural pseudo", () => {
    expect(parseProceduralSelector(".a > .b")).toBeNull();
  });
});

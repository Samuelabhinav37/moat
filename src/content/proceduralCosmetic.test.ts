// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { startProceduralCosmetic } from "./proceduralCosmetic";
import type { ProceduralRule } from "../types";

const rule = (partial: Partial<ProceduralRule> & { s: string }): ProceduralRule => ({
  t: [],
  x: partial.s + JSON.stringify(partial.t ?? []),
  ...partial,
});

const isHidden = (el: Element | null) => !!el && (el as HTMLElement).style.display === "none";
const settle = () => new Promise((r) => setTimeout(r, 20));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("startProceduralCosmetic — task types", () => {
  it(":has-text hides the matching element", () => {
    document.body.innerHTML = `<div class="card">buy now</div><div class="card">Sponsored content</div>`;
    startProceduralCosmetic(document, [rule({ s: ".card", t: [["has-text", "Sponsored"]] })]);
    const cards = document.querySelectorAll(".card");
    expect(isHidden(cards[0]!)).toBe(false);
    expect(isHidden(cards[1]!)).toBe(true);
  });

  it(":has-text accepts a /regex/ argument", () => {
    document.body.innerHTML = `<p class="x">AD BREAK</p><p class="x">news</p>`;
    startProceduralCosmetic(document, [rule({ s: ".x", t: [["has-text", "/^ad\\b/i"]] })]);
    expect(isHidden(document.querySelectorAll(".x")[0]!)).toBe(true);
    expect(isHidden(document.querySelectorAll(".x")[1]!)).toBe(false);
  });

  it(":min-text-length filters by trimmed text length", () => {
    document.body.innerHTML = `<div class="q">short</div><div class="q">${"x".repeat(60)}</div>`;
    startProceduralCosmetic(document, [rule({ s: ".q", t: [["min-text-length", 50]] })]);
    expect(isHidden(document.querySelectorAll(".q")[0]!)).toBe(false);
    expect(isHidden(document.querySelectorAll(".q")[1]!)).toBe(true);
  });

  it(":upward(n) walks up to an ancestor and hides that", () => {
    document.body.innerHTML = `<section id="wrap"><div><span class="tag">Ad</span></div></section>`;
    startProceduralCosmetic(document, [rule({ s: ".tag", t: [["has-text", "Ad"], ["upward", 2]] })]);
    expect(isHidden(document.getElementById("wrap"))).toBe(true);
  });

  it(":upward(selector) hides the nearest matching ancestor", () => {
    document.body.innerHTML = `<div class="promo-box"><p><a class="lnk">x</a></p></div>`;
    startProceduralCosmetic(document, [rule({ s: ".lnk", t: [["upward-sel", ".promo-box"]] })]);
    expect(isHidden(document.querySelector(".promo-box"))).toBe(true);
  });

  it(":xpath with no prefix selects from the document", () => {
    document.body.innerHTML = `<div id="a" data-ad="1">x</div><div id="b">y</div>`;
    startProceduralCosmetic(document, [rule({ s: "", t: [["xpath", "//div[@data-ad]"]] })]);
    expect(isHidden(document.getElementById("a"))).toBe(true);
    expect(isHidden(document.getElementById("b"))).toBe(false);
  });

  it("a bare selector:remove() removes matching elements", () => {
    document.body.innerHTML = `<div class="banner">x</div><div class="keep">y</div>`;
    startProceduralCosmetic(document, [rule({ s: ".banner", t: [], r: 1 })]);
    expect(document.querySelector(".banner")).toBeNull();
    expect(document.querySelector(".keep")).not.toBeNull();
  });

  it("never removes <html>, <head> or <body>", () => {
    startProceduralCosmetic(document, [rule({ s: "body", t: [], r: 1 })]);
    expect(document.body).not.toBeNull();
  });
});

describe("startProceduralCosmetic — lifecycle", () => {
  it("applies to nodes added later, then self-disables", async () => {
    startProceduralCosmetic(document, [rule({ s: ".late", t: [["has-text", "promo"]] })], {
      flushDelayMs: 0,
      quietFlushesToStop: 2,
    });

    const el = document.createElement("div");
    el.className = "late";
    el.textContent = "promo here";
    document.body.append(el);
    await settle();
    expect(isHidden(el)).toBe(true);

    // Well past the quiet threshold -- observer should have disconnected.
    for (let i = 0; i < 5; i += 1) {
      document.body.append(document.createElement("span"));
      await settle();
    }
    const late2 = document.createElement("div");
    late2.className = "late";
    late2.textContent = "promo two";
    document.body.append(late2);
    await settle();
    expect(isHidden(late2)).toBe(false);
  });

  it("stop() disconnects the observer", async () => {
    const handle = startProceduralCosmetic(document, [rule({ s: ".z", t: [["has-text", "x"]] })], { flushDelayMs: 0 });
    handle.stop();
    const el = document.createElement("div");
    el.className = "z";
    el.textContent = "x";
    document.body.append(el);
    await settle();
    expect(isHidden(el)).toBe(false);
  });

  it("drops invalid rules and is a no-op when none are valid", () => {
    const handle = startProceduralCosmetic(document, [
      rule({ s: "a".repeat(400), t: [["has-text", "x"]] }), // prefix too long
      rule({ s: ".a", t: [["xpath", "//a<b"]] }), // unsafe xpath arg
      rule({ s: "", t: [] }), // empty + no remove
    ]);
    // No throw, inert handle.
    expect(() => handle.stop()).not.toThrow();
  });

  it("one throwing rule doesn't stop the others", () => {
    document.body.innerHTML = `<div class="ok">Sponsored</div>`;
    startProceduralCosmetic(document, [
      rule({ s: ":::bad-css", t: [["has-text", "x"]] }), // querySelectorAll throws
      rule({ s: ".ok", t: [["has-text", "Sponsored"]] }),
    ]);
    expect(isHidden(document.querySelector(".ok"))).toBe(true);
  });
});

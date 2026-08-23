// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { generateSelector, isUnpickable } from "./generateSelector";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("generateSelector", () => {
  it("prefers a stable id over classes", () => {
    const el = document.createElement("div");
    el.id = "sponsored-banner";
    el.className = "ad";
    document.body.append(el);
    expect(generateSelector(el)).toBe("#sponsored-banner");
  });

  it("rejects a generated-looking id (long digit run) and falls back to classes", () => {
    const el = document.createElement("div");
    el.id = "ad-slot-48213";
    el.className = "ad-unit";
    document.body.append(el);
    expect(generateSelector(el)).toBe("div.ad-unit");
  });

  it("rejects a hex-hash-looking id", () => {
    const el = document.createElement("div");
    el.id = "a1b2c3d4e5";
    el.className = "banner";
    document.body.append(el);
    expect(generateSelector(el)).toBe("div.banner");
  });

  it("rejects a CSS-modules/styled-components style class (short-prefix-dash-hash)", () => {
    const el = document.createElement("div");
    el.className = "sc-bdVaJa real-name";
    document.body.append(el);
    expect(generateSelector(el)).toBe("div.real-name");
  });

  it("uses up to two stable classes when there's no usable id", () => {
    const el = document.createElement("div");
    el.className = "ad promoted extra-class";
    document.body.append(el);
    expect(generateSelector(el)).toBe("div.ad.promoted");
  });

  it("falls back to a structural path when there's no usable id or class", () => {
    const grandparent = document.createElement("main");
    const parent = document.createElement("section");
    const el = document.createElement("div");
    parent.append(document.createElement("span"), el);
    grandparent.append(parent);
    document.body.append(grandparent);
    expect(generateSelector(el)).toBe("main:nth-child(1) > section:nth-child(1) > div:nth-child(2)");
  });

  it("caps the structural path at a few ancestor levels rather than walking to the root", () => {
    let node = document.body;
    for (let i = 0; i < 6; i += 1) {
      const child = document.createElement("div");
      node.append(child);
      node = child;
    }
    const selector = generateSelector(node);
    expect(selector.split(">")).toHaveLength(3);
  });

  it("escapes special characters in ids and classes", () => {
    const el = document.createElement("div");
    el.id = "weird:id";
    document.body.append(el);
    expect(generateSelector(el)).toBe("#weird\\:id");
  });
});

describe("isUnpickable", () => {
  it("refuses html and body", () => {
    expect(isUnpickable(document.documentElement)).toBe(true);
    expect(isUnpickable(document.body)).toBe(true);
  });

  it("allows an ordinary element", () => {
    expect(isUnpickable(document.createElement("div"))).toBe(false);
  });
});

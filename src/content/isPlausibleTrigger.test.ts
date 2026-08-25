// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { isPlausibleTrigger } from "./isPlausibleTrigger";

function mockRect(el: Element, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});

describe("isPlausibleTrigger", () => {
  it("rejects a null target", () => {
    expect(isPlausibleTrigger(null)).toBe(false);
  });

  it("rejects a non-Element target", () => {
    const textNode = document.createTextNode("hi");
    expect(isPlausibleTrigger(textNode)).toBe(false);
  });

  it("rejects a target with no interactive ancestor", () => {
    const div = document.createElement("div");
    document.body.append(div);
    mockRect(div, 100, 40);
    expect(isPlausibleTrigger(div)).toBe(false);
  });

  it("accepts a normal, visible button", () => {
    const button = document.createElement("button");
    document.body.append(button);
    mockRect(button, 120, 36);
    expect(isPlausibleTrigger(button)).toBe(true);
  });

  it("accepts a click on a child of a link (closest() traversal)", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    const span = document.createElement("span");
    anchor.append(span);
    document.body.append(anchor);
    mockRect(anchor, 80, 20);
    expect(isPlausibleTrigger(span)).toBe(true);
  });

  it("rejects an invisible, full-viewport overlay -- the popunder hijack pattern", () => {
    const overlay = document.createElement("button");
    overlay.style.opacity = "0";
    document.body.append(overlay);
    mockRect(overlay, 1000, 800);
    expect(isPlausibleTrigger(overlay)).toBe(false);
  });

  it("accepts a full-viewport element that is actually visible", () => {
    // Large isn't inherently suspicious -- e.g. a real full-screen modal's
    // close button. Only large *and* invisible is the hijack signature.
    const modalClose = document.createElement("button");
    modalClose.style.opacity = "1";
    document.body.append(modalClose);
    mockRect(modalClose, 1000, 800);
    expect(isPlausibleTrigger(modalClose)).toBe(true);
  });

  it("accepts a small, low-opacity element (invisible alone isn't the signal)", () => {
    const faint = document.createElement("button");
    faint.style.opacity = "0.01";
    document.body.append(faint);
    mockRect(faint, 40, 20);
    expect(isPlausibleTrigger(faint)).toBe(true);
  });

  it("rejects a full-viewport overlay hidden via visibility:hidden", () => {
    const overlay = document.createElement("button");
    overlay.style.visibility = "hidden";
    document.body.append(overlay);
    mockRect(overlay, 1000, 800);
    expect(isPlausibleTrigger(overlay)).toBe(false);
  });

  it("rejects a full-viewport overlay hidden via a fully-collapsed clip", () => {
    const overlay = document.createElement("button");
    overlay.style.clip = "rect(0px, 0px, 0px, 0px)";
    document.body.append(overlay);
    mockRect(overlay, 1000, 800);
    expect(isPlausibleTrigger(overlay)).toBe(false);
  });
});

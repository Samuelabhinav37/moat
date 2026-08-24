// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Cmp } from "./cmp";
import { newContext } from "./tools";
import { REJECT_ALL } from "./types";
import type { CmpConfig } from "./types";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Cmp.isPresent / isShowing", () => {
  it("is not present when no detector's presentMatcher matches", () => {
    document.body.innerHTML = "<div></div>";
    const cmp = new Cmp("test", { detectors: [{ presentMatcher: { type: "css", target: { selector: ".cmp" } } }], methods: [] });
    expect(cmp.isPresent(newContext(document.body))).toBe(false);
  });

  it("is present once a detector's presentMatcher matches", () => {
    document.body.innerHTML = '<div class="cmp"></div>';
    const cmp = new Cmp("test", { detectors: [{ presentMatcher: { type: "css", target: { selector: ".cmp" } } }], methods: [] });
    expect(cmp.isPresent(newContext(document.body))).toBe(true);
  });

  it("requires every matcher in an array presentMatcher to match", () => {
    document.body.innerHTML = '<div class="a"></div>';
    const config: CmpConfig = {
      detectors: [
        {
          presentMatcher: [
            { type: "css", target: { selector: ".a" } },
            { type: "css", target: { selector: ".b" } },
          ],
        },
      ],
      methods: [],
    };
    const cmp = new Cmp("test", config);
    expect(cmp.isPresent(newContext(document.body))).toBe(false);
    document.body.innerHTML += '<div class="b"></div>';
    expect(cmp.isPresent(newContext(document.body))).toBe(true);
  });

  it("is showing by default when a matched detector has no showingMatcher", () => {
    document.body.innerHTML = '<div class="cmp"></div>';
    const cmp = new Cmp("test", { detectors: [{ presentMatcher: { type: "css", target: { selector: ".cmp" } } }], methods: [] });
    expect(cmp.isShowing(newContext(document.body))).toBe(true);
  });

  it("is not showing when the showingMatcher doesn't match, even though present", () => {
    document.body.innerHTML = '<div class="cmp"></div>';
    const config: CmpConfig = {
      detectors: [
        {
          presentMatcher: { type: "css", target: { selector: ".cmp" } },
          showingMatcher: { type: "css", target: { selector: ".cmp", displayFilter: true } },
        },
      ],
      methods: [],
    };
    const cmp = new Cmp("test", config);
    const el = document.querySelector(".cmp") as HTMLElement;
    Object.defineProperty(el, "offsetHeight", { value: 0 });
    expect(cmp.isPresent(newContext(document.body))).toBe(true);
    expect(cmp.isShowing(newContext(document.body))).toBe(false);
  });
});

describe("Cmp.runMethod", () => {
  it("executes the named method's action", async () => {
    document.body.innerHTML = '<button class="reject"></button>';
    const onClick = vi.fn();
    document.querySelector(".reject")!.addEventListener("click", onClick);
    const cmp = new Cmp("test", {
      detectors: [],
      methods: [{ name: "SAVE_CONSENT", action: { type: "click", target: { selector: ".reject" } } }],
    });
    await cmp.runMethod("SAVE_CONSENT", REJECT_ALL, newContext(document.body));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does nothing (no throw) for a method the CMP doesn't define", async () => {
    const cmp = new Cmp("test", { detectors: [], methods: [] });
    await expect(cmp.runMethod("SAVE_CONSENT", REJECT_ALL, newContext(document.body))).resolves.toBeUndefined();
  });

  it("resolves runmethod actions against this CMP's own other methods", async () => {
    document.body.innerHTML = '<button class="custom"></button>';
    const onClick = vi.fn();
    document.querySelector(".custom")!.addEventListener("click", onClick);
    const cmp = new Cmp("test", {
      detectors: [],
      methods: [
        { name: "SAVE_CONSENT", action: { type: "runmethod", method: "MY_STEP" } },
        { name: "MY_STEP", action: { type: "click", target: { selector: ".custom" } }, custom: true },
      ],
    });
    await cmp.runMethod("SAVE_CONSENT", REJECT_ALL, newContext(document.body));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

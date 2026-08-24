// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { find, findElement, newContext } from "./tools";
import type { Selection } from "./types";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findElement", () => {
  it("finds a single element by selector", () => {
    document.body.innerHTML = '<div class="banner">hi</div>';
    const el = findElement({ selector: ".banner" }, null, newContext(document.body), false);
    expect(el?.className).toBe("banner");
  });

  it("returns null when nothing matches", () => {
    document.body.innerHTML = "<div></div>";
    expect(findElement({ selector: ".missing" }, null, newContext(document.body), false)).toBeNull();
  });

  it("finds multiple elements when multiple is true", () => {
    document.body.innerHTML = '<div class="x"></div><div class="x"></div>';
    expect(findElement({ selector: ".x" }, null, newContext(document.body), true)).toHaveLength(2);
  });

  it("filters by textFilter, case-insensitively and substring", () => {
    document.body.innerHTML = '<button>Reject All</button><button>Accept</button>';
    const el = findElement({ selector: "button", textFilter: "reject" }, null, newContext(document.body), false);
    expect(el?.textContent).toBe("Reject All");
  });

  it("collapses multiple spaces the same way in the element text and the filter", () => {
    document.body.innerHTML = "<button>Reject   all cookies</button>";
    const el = findElement({ selector: "button", textFilter: "reject all" }, null, newContext(document.body), false);
    expect(el).not.toBeNull();
  });

  it("matches any of an array of textFilter values", () => {
    document.body.innerHTML = "<button>Decline</button>";
    const el = findElement({ selector: "button", textFilter: ["reject", "decline"] }, null, newContext(document.body), false);
    expect(el).not.toBeNull();
  });

  it("displayFilter true keeps only visible elements (non-zero offsetHeight)", () => {
    document.body.innerHTML = '<div class="a" style="height:0"></div><div class="b" style="height:10px"></div>';
    // jsdom doesn't compute layout, so offsetHeight is always 0 -- simulate visibility via property override.
    const a = document.querySelector(".a") as HTMLElement;
    const b = document.querySelector(".b") as HTMLElement;
    Object.defineProperty(a, "offsetHeight", { value: 0 });
    Object.defineProperty(b, "offsetHeight", { value: 20 });
    const el = findElement({ selector: "div", displayFilter: true }, null, newContext(document.body), false);
    expect(el).toBe(b);
  });

  it("treats an element marked hiddenFromDetection as never showing, regardless of offsetHeight", () => {
    document.body.innerHTML = '<div class="a"></div>';
    const a = document.querySelector(".a") as HTMLElement;
    Object.defineProperty(a, "offsetHeight", { value: 50 });
    const ctx = newContext(document.body);
    ctx.hiddenFromDetection.add(a);
    expect(findElement({ selector: ".a", displayFilter: true }, null, ctx, false)).toBeNull();
    expect(findElement({ selector: ".a", displayFilter: false }, null, ctx, false)).toBe(a);
  });

  it(":scope selects the current base when no parent is given", () => {
    document.body.innerHTML = '<div class="root"></div>';
    const root = document.querySelector(".root")!;
    const el = findElement({ selector: ":scope" }, null, newContext(root), false);
    expect(el).toBe(root);
  });

  it(":scope selects the given parent over the base when both are present", () => {
    document.body.innerHTML = '<div class="root"><span class="child"></span></div>';
    const child = document.querySelector(".child") as Element;
    const el = findElement({ selector: ":scope" }, child, newContext(document.body), false);
    expect(el).toBe(child);
  });

  it("applies childFilter to keep only elements with a matching descendant", () => {
    document.body.innerHTML = `
      <div class="row"><input class="marker" /></div>
      <div class="row"></div>
    `;
    const childFilter: Selection = { selector: ":scope > .marker" };
    const els = findElement({ selector: ".row", childFilter }, null, newContext(document.body), true);
    expect(els).toHaveLength(1);
    expect(els[0]?.querySelector(".marker")).not.toBeNull();
  });

  it("childFilterNegate inverts the childFilter result", () => {
    document.body.innerHTML = `
      <div class="row"><input class="marker" /></div>
      <div class="row"></div>
    `;
    const childFilter: Selection = { selector: ":scope > .marker" };
    const els = findElement({ selector: ".row", childFilter, childFilterNegate: true }, null, newContext(document.body), true);
    expect(els).toHaveLength(1);
    expect(els[0]?.querySelector(".marker")).toBeNull();
  });
});

describe("find", () => {
  it("resolves a bare target with no parent", () => {
    document.body.innerHTML = '<button class="reject"></button>';
    const result = find({ selector: ".reject" }, newContext(document.body), false);
    expect(result.target?.className).toBe("reject");
    expect(result.parent).toBeNull();
  });

  it("resolves target scoped within a resolved parent", () => {
    document.body.innerHTML = '<div class="panel"><button class="reject"></button></div><button class="reject"></button>';
    const result = find(
      { parent: { selector: ".panel" }, target: { selector: ".reject" } },
      newContext(document.body),
      false
    );
    expect(result.parent?.className).toBe("panel");
    expect(result.target?.parentElement).toBe(result.parent);
  });

  it("returns a null-target result rather than throwing when nothing matches", () => {
    document.body.innerHTML = "<div></div>";
    const result = find({ selector: ".missing" }, newContext(document.body), false);
    expect(result).toEqual({ parent: null, target: null });
  });

  it("returns one pair per parent x target combination when multiple", () => {
    document.body.innerHTML = `
      <div class="panel"><button class="x"></button><button class="x"></button></div>
    `;
    const results = find({ parent: { selector: ".panel" }, target: { selector: ".x" } }, newContext(document.body), true);
    expect(results).toHaveLength(2);
  });
});

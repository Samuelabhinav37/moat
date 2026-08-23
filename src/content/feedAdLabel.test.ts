// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { findAdContainer, isAdLabel } from "./feedAdLabel";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isAdLabel", () => {
  it("matches the exact label, case-insensitively", () => {
    expect(isAdLabel("Sponsored")).toBe(true);
    expect(isAdLabel("sponsored")).toBe(true);
    expect(isAdLabel("AD")).toBe(true);
    expect(isAdLabel("Paid partnership")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isAdLabel("  Sponsored  \n")).toBe(true);
  });

  it("does not match a label embedded in a longer sentence", () => {
    expect(isAdLabel("This post is sponsored by nobody")).toBe(false);
    expect(isAdLabel("Ad-free experience")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(isAdLabel("2h ago")).toBe(false);
    expect(isAdLabel("")).toBe(false);
  });
});

describe("findAdContainer", () => {
  it("finds the enclosing article for an Instagram-style post", () => {
    document.body.innerHTML = `
      <article>
        <header><span id="label">Sponsored</span></header>
        <div>post body</div>
      </article>
    `;
    const label = document.getElementById("label")!;
    expect(findAdContainer(label)?.tagName).toBe("ARTICLE");
  });

  it("finds an enclosing YouTube renderer tag", () => {
    document.body.innerHTML = `
      <ytd-rich-item-renderer>
        <span id="label">Ad</span>
      </ytd-rich-item-renderer>
    `;
    const label = document.getElementById("label")!;
    expect(findAdContainer(label)?.tagName.toLowerCase()).toBe("ytd-rich-item-renderer");
  });

  it("returns null when no known container ancestor exists", () => {
    document.body.innerHTML = `<div><span id="label">Sponsored</span></div>`;
    const label = document.getElementById("label")!;
    expect(findAdContainer(label)).toBeNull();
  });
});

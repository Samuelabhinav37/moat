// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyLongList, PREVIEW_ROWS, SEARCH_FROM, visibleRowMask } from "./longList";

const labels = {
  search: "Search",
  showAll: (count: number) => `Show all ${count}`,
  showFewer: "Show fewer",
  noMatches: "No matches.",
};

function buildList(count: number): { list: HTMLUListElement; box: HTMLElement } {
  document.body.replaceChildren();
  const box = document.createElement("div");
  const list = document.createElement("ul");
  box.append(list);
  document.body.append(box);
  fill(list, count);
  return { list, box };
}

function fill(list: HTMLUListElement, count: number): void {
  list.replaceChildren(
    ...Array.from({ length: count }, (_, i) => {
      const li = document.createElement("li");
      li.dataset.search = `site${i}.example`;
      li.textContent = `site${i}.example Remove`;
      return li;
    })
  );
}

const shownRows = (list: HTMLElement) => Array.from(list.children).filter((row) => !(row as HTMLElement).hidden).length;

describe("visibleRowMask", () => {
  it("shows the first rows, or all of them once expanded", () => {
    const texts = Array.from({ length: 9 }, (_, i) => `row ${i}`);
    expect(visibleRowMask(texts, { expanded: false, query: "" }).filter(Boolean)).toHaveLength(PREVIEW_ROWS);
    expect(visibleRowMask(texts, { expanded: true, query: "" }).every(Boolean)).toBe(true);
  });

  it("shows every match while searching, ignoring case and the preview limit", () => {
    const texts = ["News.example", "shop.example", "news.other", "a", "b", "c", "news.third"];
    expect(visibleRowMask(texts, { expanded: false, query: " NEWS " })).toEqual([true, false, true, false, false, false, true]);
  });
});

describe("applyLongList", () => {
  it("leaves a short list alone", () => {
    const { list } = buildList(PREVIEW_ROWS);
    applyLongList(list, labels);
    expect(shownRows(list)).toBe(PREVIEW_ROWS);
    expect((document.querySelector(".list-more") as HTMLElement).hidden).toBe(true);
    expect((document.querySelector(".list-search") as HTMLElement).hidden).toBe(true);
  });

  it("collapses a long list behind a Show all button, and expands it", () => {
    const { list } = buildList(12);
    applyLongList(list, labels);
    const button = document.querySelector(".list-more button") as HTMLButtonElement;
    expect(shownRows(list)).toBe(PREVIEW_ROWS);
    expect(button.textContent).toBe("Show all 12");
    button.click();
    expect(shownRows(list)).toBe(12);
    expect(button.textContent).toBe("Show fewer");
  });

  it(`adds a search box from ${SEARCH_FROM} rows that filters on the row's own text, not its button`, () => {
    const { list, box } = buildList(SEARCH_FROM);
    applyLongList(list, labels);
    const search = document.querySelector(".list-search") as HTMLInputElement;
    expect(search.hidden).toBe(false);

    search.value = "site7";
    search.dispatchEvent(new Event("input"));
    expect(shownRows(list)).toBe(1);

    search.value = "remove";
    search.dispatchEvent(new Event("input"));
    expect(shownRows(list)).toBe(0);
    expect(box.hidden).toBe(true);
    expect(document.querySelector(".list-more span")!.textContent).toBe("No matches.");
  });

  it("keeps the expanded view when the list re-renders after a removal", () => {
    const { list } = buildList(12);
    applyLongList(list, labels);
    (document.querySelector(".list-more button") as HTMLButtonElement).click();
    fill(list, 11);
    applyLongList(list, labels);
    expect(shownRows(list)).toBe(11);
    expect(document.querySelectorAll(".list-search")).toHaveLength(1);
  });

  it("puts the controls around the list itself when the list is the bordered box", () => {
    document.body.replaceChildren();
    const field = document.createElement("div");
    const list = document.createElement("ul");
    list.className = "site-list box";
    field.append(list);
    document.body.append(field);
    fill(list, SEARCH_FROM);
    applyLongList(list, labels);
    expect(list.previousElementSibling?.className).toBe("list-search");
    expect(list.nextElementSibling?.className).toBe("list-more");
    expect(field.hidden).toBe(false);
  });
});

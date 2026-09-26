// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyBulkSelect } from "./bulkSelect";
import { applyLongList } from "./longList";

const labels = {
  selectAll: "Select all",
  selectRow: (label: string) => `Select ${label}`,
  selected: (count: number) => `${count} selected`,
  action: (count: number) => `Resume ${count}`,
};
const listLabels = { search: "Search", showAll: (n: number) => `Show all ${n}`, showFewer: "Show fewer", noMatches: "No matches." };

let acted: string[][] = [];
let list: HTMLUListElement;

function render(keys: string[]): HTMLElement[] {
  const rows = keys.map((key) => {
    const li = document.createElement("li");
    li.dataset.search = key;
    li.append(Object.assign(document.createElement("span"), { textContent: key }));
    return li;
  });
  list.replaceChildren(...rows);
  applyLongList(list, listLabels);
  applyBulkSelect(list, rows, keys, labels, async (chosen) => {
    acted.push(chosen);
  });
  return rows;
}

const bar = () => document.querySelector(".bulk-bar") as HTMLElement;
const all = () => document.querySelector(".bulk-all input") as HTMLInputElement;
const button = () => document.querySelector(".bulk-action") as HTMLButtonElement;
const tick = (row: HTMLElement) => {
  const box = row.querySelector("input.row-check") as HTMLInputElement;
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change"));
};

beforeEach(() => {
  acted = [];
  document.body.innerHTML = '<div class="box"><ul id="l"></ul></div>';
  list = document.getElementById("l") as HTMLUListElement;
});

describe("applyBulkSelect", () => {
  it("stays out of the way for a single entry", () => {
    const [row] = render(["a.example"]);
    expect(bar().hidden).toBe(true);
    expect(row!.querySelector("input.row-check")).toBeNull();
  });

  it("acts on exactly the ticked rows and says how many", async () => {
    const rows = render(["a.example", "b.example", "c.example"]);
    expect(button().hidden).toBe(true);
    tick(rows[0]!);
    tick(rows[2]!);
    expect(button().textContent).toBe("Resume 2");
    expect(bar().textContent).toContain("2 selected");
    expect(all().indeterminate).toBe(true);
    button().click();
    await Promise.resolve();
    expect(acted).toEqual([["a.example", "c.example"]]);
  });

  it("Select all takes every row, even ones folded behind Show all", () => {
    const keys = Array.from({ length: 7 }, (_, i) => `s${i}.example`);
    render(keys);
    all().checked = true;
    all().dispatchEvent(new Event("change"));
    expect(button().textContent).toBe("Resume 7");
  });

  it("while searching, Select all takes only the matches", () => {
    const keys = ["news.a", "news.b", "shop.c", "shop.d", "e", "f", "g", "h"];
    render(keys);
    const search = document.querySelector(".list-search") as HTMLInputElement;
    search.value = "news";
    search.dispatchEvent(new Event("input"));
    all().checked = true;
    all().dispatchEvent(new Event("change"));
    expect(button().textContent).toBe("Resume 2");
  });

  it("drops a selected entry that's gone after a re-render", () => {
    const rows = render(["a.example", "b.example", "c.example"]);
    tick(rows[1]!);
    render(["a.example", "c.example"]);
    expect(button().hidden).toBe(true);
    expect(document.querySelectorAll(".bulk-bar")).toHaveLength(1);
  });
});

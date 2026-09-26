// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { collectItems, initSettingsSearch, MAX_RESULTS, rankItems, type SearchItem } from "./settingsSearch";

function page(): void {
  window.location.hash = "";
  document.body.innerHTML = `
    <nav class="dash-nav">
      <a data-page="blocking"><span class="nav-name">Blocking</span></a>
      <a data-page="privacy"><span class="nav-name">Privacy extras</span></a>
      <a data-page="rules"><span class="nav-name">Block and allow</span></a>
    </nav>
    <input id="q" /><ul id="results" hidden></ul>
    <section data-page="blocking">
      <div><h2>How much to block</h2><p class="lead">Applies to every site.</p></div>
      <button class="level"><span class="level-name">Strict</span><span class="level-desc">Also cookie notices and fingerprinting.</span></button>
      <div class="setting-row" id="cookie-row"><span class="setting-title">Say no to cookie banners</span><span class="setting-desc">Answers consent pop-ups for you.</span></div>
    </section>
    <section data-page="privacy">
      <div><h2>Privacy extras</h2></div>
      <div class="setting-row"><span class="setting-title">Block cross-site cookies</span><span class="setting-desc">Stops sites following you.</span></div>
    </section>
    <section data-page="rules">
      <div><h2>Block and allow</h2></div>
      <div class="field" id="never-field"><span class="field-label">Never block</span><span class="field-hint">Even when a filter list matches.</span></div>
    </section>`;
}

beforeEach(page);

const titles = (items: SearchItem[]) => items.map((i) => i.title);

describe("collectItems", () => {
  it("indexes sections, setting rows, levels and rule fields with where they live", () => {
    const items = collectItems();
    expect(titles(items)).toEqual([
      "How much to block",
      "Say no to cookie banners",
      "Strict",
      "Privacy extras",
      "Block cross-site cookies",
      "Block and allow",
      "Never block",
    ]);
    const cookie = items.find((i) => i.title === "Say no to cookie banners")!;
    expect(cookie.page).toBe("blocking");
    expect(cookie.where).toBe("Blocking › How much to block");
    expect(items.find((i) => i.title === "Never block")!.where).toBe("Block and allow");
  });
});

describe("rankItems", () => {
  it("ranks titles that start with the query first, then title matches, then description matches", () => {
    expect(titles(rankItems(collectItems(), "cookie"))).toEqual(["Say no to cookie banners", "Block cross-site cookies", "Strict"]);
    expect(titles(rankItems(collectItems(), "block"))[0]).toBe("Block cross-site cookies");
  });

  it("needs every word, ignores case, and returns nothing for an empty query", () => {
    expect(titles(rankItems(collectItems(), "COOKIE banners"))).toEqual(["Say no to cookie banners"]);
    expect(rankItems(collectItems(), "   ")).toEqual([]);
    expect(rankItems(collectItems(), "zebra")).toEqual([]);
  });

  it(`returns at most ${MAX_RESULTS}`, () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `Row ${i}`, detail: "", where: "", page: "blocking" as const, target: document.body }));
    expect(rankItems(many, "row")).toHaveLength(MAX_RESULTS);
  });
});

describe("initSettingsSearch", () => {
  function setup(isDesktop: boolean) {
    const input = document.getElementById("q") as HTMLInputElement;
    const list = document.getElementById("results") as HTMLUListElement;
    const revealed: HTMLElement[] = [];
    initSettingsSearch(input, list, { reveal: (t) => revealed.push(t), noResults: "No settings match.", isDesktop: () => isDesktop });
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input"));
    };
    const key = (k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    return { input, list, revealed, type, key };
  }

  it("shows results as you type and says when nothing matches", () => {
    const { list, type } = setup(true);
    type("cookie");
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll("li[role=option]")).toHaveLength(3);
    expect(list.querySelector("li[aria-selected=true] .result-where")!.textContent).toBe("Blocking › How much to block");
    type("zebra");
    expect(list.textContent).toBe("No settings match.");
  });

  it("on desktop, Enter opens the result's screen", () => {
    const { list, type, key } = setup(true);
    type("never");
    key("Enter");
    expect(window.location.hash).toBe("#rules");
    expect(list.hidden).toBe(true);
  });

  it("on a phone, the arrow keys pick a result and Enter reveals it in place", () => {
    const { type, key, revealed } = setup(false);
    type("cookie");
    key("ArrowDown");
    key("Enter");
    expect(revealed[0]!.querySelector(".setting-title")!.textContent).toBe("Block cross-site cookies");
    expect(window.location.hash).toBe("");
  });

  it("Escape clears and closes", () => {
    const { input, list, type, key } = setup(true);
    type("cookie");
    key("Escape");
    expect(input.value).toBe("");
    expect(list.hidden).toBe(true);
  });

  it('"/" focuses the search box unless you are typing somewhere', () => {
    const { input } = setup(true);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    expect(document.activeElement).toBe(input);
  });
});

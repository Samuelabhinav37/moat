// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { collectItems, initSettingsSearch, MAX_RESULTS, rankItems, type SearchItem } from "./settingsSearch";

function page(): void {
  window.location.hash = "";
  document.body.innerHTML = `
    <nav class="dash-nav">
      <a data-page="protection"><span class="nav-name">Protection</span></a>
      <a data-page="exceptions"><span class="nav-name">Exceptions</span></a>
    </nav>
    <input id="q" /><ul id="results" hidden></ul>
    <section data-page="protection">
      <div><h2>How much to block</h2><p class="lead">Applies to every site.</p></div>
      <button class="level"><span class="level-name">Strict</span><span class="level-desc">Also cookie notices and fingerprinting.</span></button>
      <div class="setting-row" id="cookie-row"><span class="setting-title">Say no to cookie banners</span><span class="setting-desc">Answers consent pop-ups for you.</span></div>
    </section>
    <section data-page="protection">
      <div><h2>Privacy extras</h2></div>
      <div class="setting-row"><span class="setting-title">Block cross-site cookies</span><span class="setting-desc">Stops sites following you.</span></div>
    </section>
    <section data-page="exceptions" data-tab="rules">
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
    expect(cookie.page).toBe("protection");
    expect(cookie.where).toBe("Protection › How much to block");
    expect(items.find((i) => i.title === "Never block")!.where).toBe("Exceptions › Block and allow");
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
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `Row ${i}`, detail: "", where: "", page: "protection" as const, target: document.body }));
    expect(rankItems(many, "row")).toHaveLength(MAX_RESULTS);
  });
});

describe("initSettingsSearch", () => {
  function setup() {
    const input = document.getElementById("q") as HTMLInputElement;
    const list = document.getElementById("results") as HTMLUListElement;
    initSettingsSearch(input, list, { noResults: "No settings match." });
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input"));
    };
    const key = (k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    return { input, list, type, key };
  }

  it("shows results as you type and says when nothing matches", () => {
    const { list, type } = setup();
    type("cookie");
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll("li[role=option]")).toHaveLength(3);
    expect(list.querySelector("li[aria-selected=true] .result-where")!.textContent).toBe("Protection › How much to block");
    type("zebra");
    expect(list.textContent).toBe("No settings match.");
  });

  it("Enter opens the result's screen, at any window width", () => {
    const { list, type, key } = setup();
    type("never");
    key("Enter");
    expect(window.location.hash).toBe("#exceptions");
    expect(list.hidden).toBe(true);
  });

  it("the arrow keys pick another result", () => {
    const { type, key } = setup();
    window.location.hash = "";
    type("cookie");
    key("ArrowDown");
    key("Enter");
    expect(window.location.hash).toBe("#protection");
  });

  it("Escape clears and closes", () => {
    const { input, list, type, key } = setup();
    type("cookie");
    key("Escape");
    expect(input.value).toBe("");
    expect(list.hidden).toBe(true);
  });

  it('"/" focuses the search box unless you are typing somewhere', () => {
    const { input } = setup();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    expect(document.activeElement).toBe(input);
  });
});

describe("finding what people type", () => {
  it("matches common other names and lands on the screen they mean", () => {
    expect(titles(rankItems(collectItems(), "whitelist")).slice(0, 2)).toContain("Never block");
    expect(rankItems(collectItems(), "whitelist")[0]!.page).toBe("exceptions");
    expect(rankItems(collectItems(), "allow")[0]!.page).toBe("exceptions");
  });

  it("finds sites you added yourself, on their screen", () => {
    document.querySelector('section[data-tab="rules"]')!.insertAdjacentHTML("beforeend", '<ul><li data-search="bank.example">bank.example</li></ul>');
    const hit = rankItems(collectItems(), "bank")[0]!;
    expect(hit.title).toBe("bank.example");
    expect(hit.page).toBe("exceptions");
  });

  it("answers questions Moat has no setting for", async () => {
    const { noSettingAnswer } = await import("./settingsSearch");
    expect(noSettingAnswer("dark")!.fallback).toBe("Moat follows your system's light or dark theme.");
    expect(noSettingAnswer("da")).toBeNull();
    const input = document.getElementById("q") as HTMLInputElement;
    const list = document.getElementById("results") as HTMLUListElement;
    initSettingsSearch(input, list, { noResults: "No settings match." });
    input.value = "dark mode";
    input.dispatchEvent(new Event("input"));
    expect(list.textContent).toBe("Moat follows your system's light or dark theme.");
  });

  it("runs an extra result's own action (Help topics)", () => {
    const input = document.getElementById("q") as HTMLInputElement;
    const list = document.getElementById("results") as HTMLUListElement;
    let opened = "";
    initSettingsSearch(input, list, { noResults: "x", extraItems: () => [{ title: "Page won't load", detail: "", where: "Help", page: "overview", target: document.body, open: () => (opened = "load") }] });
    input.value = "won't load";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(opened).toBe("load");
  });
});

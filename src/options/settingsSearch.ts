// "Search settings" in the Settings top bar. The index is read from the page
// itself each time (sections, setting rows, levels, rule fields), so it
// always matches what's rendered, including rows options.ts builds later and
// whatever language the page is in. Picking a result opens its screen,
// scrolls to it and briefly highlights it.

import { pageFromHash, revealTab, type PageKey } from "./dashboard";

export interface SearchItem {
  title: string;
  /** Extra text that matches but isn't shown (the row's description). */
  detail: string;
  /** Where it lives, shown under the title: "Blocking › Features". */
  where: string;
  page: PageKey;
  target: HTMLElement;
}

export const MAX_RESULTS = 8;

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function pageName(doc: Document, page: string): string {
  return text(doc.querySelector(`.dash-nav a[data-page="${page}"] .nav-name`));
}

export function collectItems(doc: Document = document): SearchItem[] {
  const items: SearchItem[] = [];
  for (const section of doc.querySelectorAll<HTMLElement>("section[data-page]")) {
    const page = pageFromHash(section.dataset.page ?? "");
    const screen = pageName(doc, page);
    const heading = text(section.querySelector("h2"));
    const where = heading && heading !== screen ? `${screen} › ${heading}` : screen;
    items.push({ title: heading || screen, detail: text(section.querySelector(".lead")), where: screen, page, target: section });

    for (const row of section.querySelectorAll<HTMLElement>(".setting-row")) {
      const title = text(row.querySelector(".setting-title"));
      if (title) items.push({ title, detail: text(row.querySelector(".setting-desc")), where, page, target: row });
    }
    for (const level of section.querySelectorAll<HTMLElement>(".level")) {
      const title = text(level.querySelector(".level-name"));
      if (title) items.push({ title, detail: text(level.querySelector(".level-desc")), where, page, target: level });
    }
    for (const field of section.querySelectorAll<HTMLElement>(".field")) {
      const title = text(field.querySelector(".field-label"));
      if (title) items.push({ title, detail: text(field.querySelector(".field-hint")), where, page, target: field });
    }
  }
  return items;
}

/** Every word of the query must appear in the title or detail. Title
 * matches rank first (starting with the query highest), then detail-only
 * matches, each in page order. */
export function rankItems(items: readonly SearchItem[], query: string): SearchItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const q = words.join(" ");
  const scored: { item: SearchItem; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const title = item.title.toLowerCase();
    const all = `${title} ${item.detail.toLowerCase()}`;
    if (!words.every((word) => all.includes(word))) return;
    const score = title.startsWith(q) ? 0 : words.every((word) => title.includes(word)) ? 1 : 2;
    scored.push({ item, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, MAX_RESULTS).map((s) => s.item);
}

export interface SearchOptions {
  noResults: string;
}

export function initSettingsSearch(input: HTMLInputElement, list: HTMLUListElement, options: SearchOptions): void {
  const doc = input.ownerDocument;
  const win = doc.defaultView ?? window;
  let results: SearchItem[] = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const setActive = (i: number) => {
    active = i;
    list.querySelectorAll("li[role=option]").forEach((li, n) => li.setAttribute("aria-selected", String(n === i)));
    if (i >= 0) input.setAttribute("aria-activedescendant", `search-result-${i}`);
    else input.removeAttribute("aria-activedescendant");
  };

  const go = (item: SearchItem) => {
    close();
    input.value = "";
    input.blur();
    if (pageFromHash(win.location.hash) !== item.page) win.location.hash = item.page;
    // A closed "Show all" disclosure would keep the row out of sight.
    for (let el: HTMLElement | null = item.target; el; el = el.parentElement) {
      if (el instanceof HTMLDetailsElement) el.open = true;
    }
    win.setTimeout(() => {
      revealTab(item.target, doc);
      item.target.scrollIntoView?.({ block: "center" });
      item.target.classList.remove("search-hit");
      void item.target.offsetWidth;
      item.target.classList.add("search-hit");
      win.setTimeout(() => item.target.classList.remove("search-hit"), 1800);
    }, 60);
  };

  const renderResults = () => {
    results = rankItems(collectItems(doc), input.value);
    const query = input.value.trim();
    if (!query) {
      close();
      return;
    }
    list.replaceChildren(
      ...(results.length
        ? results.map((item, i) => {
            const li = doc.createElement("li");
            li.id = `search-result-${i}`;
            li.setAttribute("role", "option");
            const title = doc.createElement("span");
            title.className = "result-title";
            title.textContent = item.title;
            const where = doc.createElement("span");
            where.className = "result-where";
            where.textContent = item.where;
            li.append(title, where);
            // mousedown, not click: fires before the input's blur closes the list.
            li.addEventListener("mousedown", (event) => {
              event.preventDefault();
              go(item);
            });
            return li;
          })
        : [Object.assign(doc.createElement("li"), { className: "result-empty", textContent: options.noResults })])
    );
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setActive(results.length ? 0 : -1);
  };

  input.addEventListener("input", renderResults);
  input.addEventListener("focus", () => {
    if (input.value.trim()) renderResults();
  });
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActive((active + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActive((active - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active]!);
    } else if (event.key === "Escape") {
      input.value = "";
      close();
    }
  });
  // "/" jumps to the search box from anywhere that isn't a text field.
  doc.addEventListener("keydown", (event) => {
    const t = event.target as HTMLElement | null;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      input.focus();
    }
  });
}

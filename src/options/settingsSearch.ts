// "Search settings" in the Settings top bar. The index is read from the page
// itself each time (sections, setting rows, levels, rule fields), so it
// always matches what's rendered, including rows options.ts builds later and
// whatever language the page is in. Picking a result opens its screen,
// scrolls to it and briefly highlights it.

import { pageFromHash, revealTab, type PageKey } from "./dashboard";

export interface SearchItem {
  title: string;
  /** Runs instead of going to the target (Help topics). */
  open?: () => void;
  /** Extra text that matches but isn't shown (the row's description). */
  detail: string;
  /** Where it lives, shown under the title: "Blocking › Features". */
  where: string;
  page: PageKey;
  target: HTMLElement;
}

export const MAX_RESULTS = 8;

/** Opens the screen a setting is on, scrolls to it and briefly highlights it.
 * Shared by search results and About's "Change" links. */
export function revealSetting(target: HTMLElement, page: PageKey, doc: Document = document, win: Window = window): void {
  if (pageFromHash(win.location.hash) !== page) win.location.hash = page;
  // A closed "Show all" disclosure would keep the row out of sight.
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement) el.open = true;
  }
  win.setTimeout(() => {
    revealTab(target, doc);
    target.scrollIntoView?.({ block: "center" });
    target.classList.remove("search-hit");
    void target.offsetWidth;
    target.classList.add("search-hit");
    win.setTimeout(() => target.classList.remove("search-hit"), 1800);
  }, 60);
}

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
    // Insights and Overview cards.
    for (const card of section.querySelectorAll<HTMLElement>(".ttl, .ov-week-head")) {
      const title = text(card.querySelector("h3"));
      if (title) items.push({ title, detail: text(card.querySelector("p")), where: screen, page, target: card.parentElement ?? card });
    }
    // What you added yourself: paused sites, hidden parts, your rules.
    for (const row of section.querySelectorAll<HTMLElement>("[data-search]")) {
      const title = row.dataset.search?.trim();
      if (title) items.push({ title, detail: "", where, page, target: row });
    }
  }
  return items;
}

/** Words people type for things Moat names differently. Each query word
 * also matches any of these. */
export const SYNONYMS: Record<string, string[]> = {
  dark: ["appearance"],
  light: ["appearance"],
  theme: ["appearance"],
  mode: ["appearance"],
  fingerprint: ["recogniz"],
  fingerprinting: ["recogniz"],
  whitelist: ["never block", "always and never"],
  allowlist: ["never block", "always and never"],
  allow: ["never block", "always and never"],
  blacklist: ["always block", "always and never"],
  blocklist: ["always block", "lists"],
  element: ["hidden", "hide"],
  hide: ["hidden"],
  popup: ["pop-up"],
  popups: ["pop-up"],
  vpn: ["ip address"],
  webrtc: ["ip address"],
  whitelisted: ["never block", "paused"],
  disable: ["pause", "off"],
  stats: ["blocked", "trackers"],
  analytics: ["trackers"],
  export: ["backup"],
  import: ["restore", "import"],
  update: ["fixes", "lists"],
};

/** Things people look for that Moat has no setting for, with the answer. */
export const NO_SETTING: Record<string, { key: string; fallback: string }> = {
  language: { key: "searchAnswerLanguage", fallback: "Moat uses your browser's language." },
  account: { key: "searchAnswerAccount", fallback: "Moat has no account. Everything stays in this browser." },
};

export function noSettingAnswer(query: string): { key: string; fallback: string } | null {
  const q = query.trim().toLowerCase();
  for (const [phrase, answer] of Object.entries(NO_SETTING)) if (q.length >= 3 && phrase.startsWith(q)) return answer;
  return null;
}

/** Every word of the query must appear in the title or detail. Title
 * matches rank first (starting with the query highest), then detail-only
 * matches, each in page order. */
export function rankItems(items: readonly SearchItem[], query: string): SearchItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const q = words.join(" ");
  const scored: { item: SearchItem; score: number; index: number }[] = [];
  const forms = (word: string) => [word, ...(SYNONYMS[word] ?? [])];
  items.forEach((item, index) => {
    const title = item.title.toLowerCase();
    const all = `${title} ${item.detail.toLowerCase()} ${item.where.toLowerCase()}`;
    if (!words.every((word) => forms(word).some((f) => all.includes(f)))) return;
    const score = title.startsWith(q)
      ? 0
      : words.every((word) => title.includes(word))
        ? 1
        : words.every((word) => forms(word).some((f) => title.includes(f)))
          ? 2
          : 3;
    scored.push({ item, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, MAX_RESULTS).map((s) => s.item);
}

export interface SearchOptions {
  noResults: string;
  /** More results from outside the page (Help topics). */
  extraItems?: () => SearchItem[];
  translate?: (key: string, fallback: string) => string;
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
    if (item.open) {
      item.open();
      return;
    }
    revealSetting(item.target, item.page, doc, win);
  };

  const renderResults = () => {
    results = rankItems([...collectItems(doc), ...(options.extraItems?.() ?? [])], input.value);
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
        : [
            Object.assign(doc.createElement("li"), {
              className: "result-empty",
              textContent: (() => {
                const answer = noSettingAnswer(query);
                return answer ? (options.translate ?? ((_k: string, f: string) => f))(answer.key, answer.fallback) : options.noResults;
              })(),
            }),
          ])
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

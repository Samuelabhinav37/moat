// Long lists on the Settings page (paused sites, hidden elements, custom
// block and allow lists). Past PREVIEW_ROWS rows only the first few show,
// with a button for the rest; past SEARCH_FROM a search box appears too, so
// a list of hundreds of sites never means scrolling through all of them.

export const PREVIEW_ROWS = 5;
export const SEARCH_FROM = 8;

export interface ListView {
  expanded: boolean;
  query: string;
}

/** Which rows to show: every match while searching, otherwise the first
 * PREVIEW_ROWS unless the list is expanded. */
export function visibleRowMask(texts: readonly string[], view: ListView): boolean[] {
  const query = view.query.trim().toLowerCase();
  if (query) return texts.map((text) => text.toLowerCase().includes(query));
  return texts.map((_, i) => view.expanded || i < PREVIEW_ROWS);
}

export interface LongListLabels {
  search: string;
  showAll: (count: number) => string;
  showFewer: string;
  noMatches: string;
}

interface ListControls {
  view: ListView;
  search: HTMLInputElement;
  more: HTMLElement;
  status: HTMLElement;
  button: HTMLButtonElement;
}

const controls = new WeakMap<HTMLElement, ListControls>();

/** Call after (re)rendering `rows`: either the list's bordered box itself
 * (class "box") or a list inside one.
 * Each row can set data-search to what the search box should match (the
 * visible text includes its Remove button). The view (expanded, query)
 * survives re-renders, so removing one row doesn't collapse the list. */
export function applyLongList(rows: HTMLElement, labels: LongListLabels): void {
  const box = rows.classList.contains("box") ? rows : rows.parentElement;
  if (!box) return;
  let c = controls.get(rows);
  if (!c) {
    const search = document.createElement("input");
    search.type = "search";
    search.className = "list-search";
    search.placeholder = labels.search;
    search.setAttribute("aria-label", labels.search);
    const more = document.createElement("div");
    more.className = "list-more";
    const status = document.createElement("span");
    const button = document.createElement("button");
    button.type = "button";
    more.append(status, button);
    box.before(search);
    box.after(more);
    const created: ListControls = { view: { expanded: false, query: "" }, search, more, status, button };
    search.addEventListener("input", () => {
      created.view.query = search.value;
      update(rows, box, created, labels);
    });
    button.addEventListener("click", () => {
      created.view.expanded = !created.view.expanded;
      update(rows, box, created, labels);
    });
    controls.set(rows, created);
    c = created;
  }
  update(rows, box, c, labels);
}

function update(rows: HTMLElement, box: HTMLElement, c: ListControls, labels: LongListLabels): void {
  const items = Array.from(rows.children) as HTMLElement[];
  const count = items.length;

  c.search.hidden = count < SEARCH_FROM;
  if (c.search.hidden && c.view.query) {
    c.view.query = "";
    c.search.value = "";
  }
  const searching = c.view.query.trim() !== "";

  const mask = visibleRowMask(
    items.map((item) => item.dataset.search ?? item.textContent ?? ""),
    c.view
  );
  items.forEach((item, i) => {
    item.hidden = !mask[i];
  });
  const shown = mask.filter(Boolean).length;

  box.hidden = searching && shown === 0;
  c.status.textContent = searching && shown === 0 ? labels.noMatches : "";
  c.button.hidden = searching || count <= PREVIEW_ROWS;
  c.button.textContent = c.view.expanded ? labels.showFewer : labels.showAll(count);
  c.more.hidden = c.button.hidden && c.status.textContent === "";
}

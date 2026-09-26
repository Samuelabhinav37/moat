// Select several entries of a Settings list and act on them at once
// (Resume or Remove). Each row gets a checkbox; a bar above the list has
// "Select all" and the action button. "Select all" takes every row, or only
// the matches while the list's search box is in use. The selection survives
// a re-render as long as its entries are still there.

export interface BulkLabels {
  selectAll: string;
  selectRow: (label: string) => string;
  selected: (count: number) => string;
  action: (count: number) => string;
}

interface BulkControls {
  bar: HTMLElement;
  all: HTMLInputElement;
  count: HTMLElement;
  button: HTMLButtonElement;
  selected: Set<string>;
  run: () => void;
}

const controls = new WeakMap<HTMLElement, BulkControls>();

export const BULK_FROM = 2;

/** `rows[i]` shows `keys[i]`. Call after every render of the list. */
export function applyBulkSelect(
  list: HTMLElement,
  rows: HTMLElement[],
  keys: string[],
  labels: BulkLabels,
  onAction: (keys: string[]) => Promise<void>
): void {
  const box = list.classList.contains("box") ? list : list.parentElement;
  if (!box) return;
  const doc = list.ownerDocument;
  let c = controls.get(list);
  if (!c) {
    const bar = doc.createElement("div");
    bar.className = "bulk-bar";
    const allLabel = doc.createElement("label");
    allLabel.className = "bulk-all";
    const all = doc.createElement("input");
    all.type = "checkbox";
    allLabel.append(all, doc.createTextNode(labels.selectAll));
    const count = doc.createElement("span");
    count.className = "bulk-count";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "bulk-action";
    bar.append(allLabel, count, button);
    box.before(bar);
    const created: BulkControls = { bar, all, count, button, selected: new Set(), run: () => {} };
    button.addEventListener("click", () => created.run());
    controls.set(list, created);
    c = created;
  }
  const state = c;

  // Forget anything that's no longer in the list.
  for (const key of [...state.selected]) if (!keys.includes(key)) state.selected.delete(key);

  const searching = () => {
    const search = box.previousElementSibling?.previousElementSibling;
    return search instanceof HTMLInputElement && search.classList.contains("list-search") && search.value.trim() !== "";
  };
  const eligible = () => keys.filter((_, i) => !searching() || !rows[i]!.hidden);

  const update = () => {
    const n = state.selected.size;
    const pool = eligible();
    state.all.checked = pool.length > 0 && pool.every((key) => state.selected.has(key));
    state.all.indeterminate = n > 0 && !state.all.checked;
    state.count.textContent = n ? labels.selected(n) : "";
    state.button.hidden = n === 0;
    state.button.textContent = labels.action(n);
    rows.forEach((row, i) => {
      const box = row.querySelector<HTMLInputElement>("input.row-check");
      if (box) box.checked = state.selected.has(keys[i]!);
      row.classList.toggle("is-selected", state.selected.has(keys[i]!));
    });
  };

  state.bar.hidden = keys.length < BULK_FROM;
  rows.forEach((row, i) => {
    if (keys.length < BULK_FROM) return;
    const key = keys[i]!;
    const check = doc.createElement("input");
    check.type = "checkbox";
    check.className = "row-check";
    check.setAttribute("aria-label", labels.selectRow(key));
    check.addEventListener("change", () => {
      if (check.checked) state.selected.add(key);
      else state.selected.delete(key);
      update();
    });
    row.prepend(check);
  });
  state.all.onchange = () => {
    const pool = eligible();
    if (state.all.checked) for (const key of pool) state.selected.add(key);
    else for (const key of pool) state.selected.delete(key);
    update();
  };
  state.run = () => {
    const chosen = keys.filter((key) => state.selected.has(key));
    if (chosen.length === 0) return;
    state.selected.clear();
    state.button.disabled = true;
    void onAction(chosen).finally(() => {
      state.button.disabled = false;
    });
  };
  update();
}

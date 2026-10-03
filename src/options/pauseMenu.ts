// "For 1 hour / For 1 day / Until I turn it back on": asked when a site is
// switched off from Settings › Sites. A small menu under the switch. Arrow
// keys move, Enter picks, Esc or a click elsewhere cancels (the caller then
// puts the switch back on).

import { PAUSE_LENGTHS, type PauseLength } from "../shared/pauseDuration";

export interface PauseMenuLabels {
  title: string;
  hour: string;
  day: string;
  always: string;
}

let closeOpenMenu: ((choice: PauseLength | null) => void) | null = null;

export function openPauseMenu(doc: Document, anchor: HTMLElement, labels: PauseMenuLabels, onPick: (choice: PauseLength | null) => void): void {
  closeOpenMenu?.(null);
  const menu = doc.createElement("div");
  menu.className = "pause-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", labels.title);
  const heading = doc.createElement("div");
  heading.className = "pause-menu-title";
  heading.setAttribute("aria-hidden", "true");
  heading.textContent = labels.title;
  menu.append(heading);
  const items = PAUSE_LENGTHS.map((length) => {
    const item = doc.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.dataset.length = length;
    item.textContent = labels[length];
    menu.append(item);
    return item;
  });

  const onOutside = (event: Event) => {
    if (!menu.contains(event.target as Node)) close(null);
  };
  const close = (choice: PauseLength | null) => {
    if (closeOpenMenu !== close) return;
    closeOpenMenu = null;
    menu.remove();
    doc.removeEventListener("pointerdown", onOutside, true);
    if (choice === null) anchor.focus();
    onPick(choice);
  };
  closeOpenMenu = close;

  menu.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-length]");
    if (item) close(item.dataset.length as PauseLength);
  });
  menu.addEventListener("keydown", (event) => {
    const i = items.indexOf(doc.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(null);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(i + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]!.focus();
    } else if (event.key === "Tab") {
      close(null);
    }
  });
  doc.addEventListener("pointerdown", onOutside, true);
  anchor.after(menu);
  items[0]!.focus();
}

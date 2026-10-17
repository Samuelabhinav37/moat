// A pop-up button's menu (Apple HIG: pop-up buttons): the button shows the
// current choice, and pressing it opens a short list of the others, each
// with one line on what it does. Used for the level on Overview and for
// what Moat does on each site in Exceptions. Arrow keys move, Enter or a
// click picks, Esc or a click elsewhere closes. Built with DOM calls.

const SVG_NS = "http://www.w3.org/2000/svg";

export interface PopChoice<T extends string> {
  value: T;
  label: string;
  desc?: string;
}

let closeOpen: (() => void) | null = null;

/** The up-and-down chevron a pop-up button carries. */
export function popChevron(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "pop-ud");
  svg.setAttribute("viewBox", "0 0 10 14");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2 5l3-3 3 3M2 9l3 3 3-3");
  svg.append(path);
  return svg;
}

function tick(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M5 12.5l4.5 4.5L19 7.5");
  svg.append(path);
  return svg;
}

/** Opens the menu under `button` (which sits in a positioned wrapper). */
export function openPopMenu<T extends string>(doc: Document, button: HTMLElement, label: string, choices: PopChoice<T>[], current: T | null, onPick: (value: T) => void): void {
  closeOpen?.();
  const menu = doc.createElement("div");
  menu.className = "pop-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  const items = choices.map((choice) => {
    const item = doc.createElement("button");
    item.type = "button";
    item.className = "pop-item";
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", String(choice.value === current));
    item.tabIndex = -1;
    item.dataset.value = choice.value;
    const mark = doc.createElement("span");
    mark.className = "pop-mark";
    if (choice.value === current) mark.append(tick(doc));
    const name = doc.createElement("b");
    name.textContent = choice.label;
    item.append(mark, name);
    if (choice.desc) {
      const desc = doc.createElement("span");
      desc.className = "pop-desc";
      desc.textContent = choice.desc;
      item.append(desc);
    }
    menu.append(item);
    return item;
  });

  const onOutside = (event: Event) => {
    if (!menu.contains(event.target as Node) && !button.contains(event.target as Node)) close();
  };
  const close = (refocus = true) => {
    if (closeOpen !== close) return;
    closeOpen = null;
    button.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", onOutside, true);
    menu.classList.add("closing");
    const done = () => menu.remove();
    menu.addEventListener("animationend", done, { once: true });
    setTimeout(done, 200);
    if (refocus) button.focus();
  };
  closeOpen = close;

  menu.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>(".pop-item");
    if (!item) return;
    close();
    if (item.dataset.value !== current) onPick(item.dataset.value as T);
  });
  menu.addEventListener("keydown", (event) => {
    const i = items.indexOf(doc.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(i + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]!.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  });
  doc.addEventListener("pointerdown", onOutside, true);
  button.setAttribute("aria-expanded", "true");
  button.after(menu);
  const view = doc.defaultView;
  if (view && menu.getBoundingClientRect().bottom > view.innerHeight - 8 && button.getBoundingClientRect().top > menu.offsetHeight + 16) menu.classList.add("up");
  (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
}

/** A pop-up button: the current choice's name and the chevron. Pressing it
 * opens the menu; `choices` is read on each press, so it stays current. */
export function buildPopButton<T extends string>(
  doc: Document,
  label: string,
  current: () => { value: T | null; text: string },
  choices: () => PopChoice<T>[],
  onPick: (value: T) => void,
  className = "pop-btn"
): HTMLElement {
  const wrap = doc.createElement("span");
  wrap.className = "pop-wrap";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const text = doc.createElement("span");
  text.className = "pop-text";
  text.textContent = current().text;
  button.setAttribute("aria-label", `${label}: ${text.textContent}`);
  button.append(text, popChevron(doc));
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-expanded") === "true") {
      closeOpen?.();
      return;
    }
    openPopMenu(doc, button, label, choices(), current().value, onPick);
  });
  wrap.append(button);
  return wrap;
}

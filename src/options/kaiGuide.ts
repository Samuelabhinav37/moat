// Kai, Moat's guide, in the bottom-right corner of Settings (as on the
// website). Pressing Kai opens a small card: one line about the screen
// you're on, and two or three buttons that do something there (start the
// checkup, show how levels work, hide something on a page, open the right
// help topic). When protection is off, Kai says so first and offers to
// turn it back on. Kai blinks but doesn't float: a looping float made
// Settings stutter (see the note in options.css). DOM calls only.
import type { Translate } from "./overviewView";

export interface KaiAction {
  label: [string, string];
  run: () => void;
}

export interface KaiLine {
  say: [string, string];
  actions: KaiAction[];
}

export interface KaiOptions {
  t: Translate;
  currentScreen: () => string;
  /** True when protection is switched off. */
  isOff: () => boolean;
  turnOn: () => void;
  openHelp: () => void;
  lines: Record<string, KaiLine>;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Kai's head with two eyelids that blink (decoration only). */
function kaiFace(doc: Document): HTMLElement {
  const face = el(doc, "span", "kai-face");
  face.setAttribute("aria-hidden", "true");
  const img = el(doc, "img");
  img.src = "characters/kai.webp";
  img.alt = "";
  face.append(img, el(doc, "i", "lid l"), el(doc, "i", "lid r"));
  return face;
}

export function initKaiGuide(doc: Document, options: KaiOptions): { open: () => void; close: () => void; isOpen: () => boolean } {
  const { t } = options;
  const root = el(doc, "div", "kai-guide");
  const card = el(doc, "div", "kai-card");
  card.id = "kai-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Kai");
  const say = el(doc, "p", "kai-say");
  say.setAttribute("aria-live", "polite");
  const actions = el(doc, "div", "kai-actions");
  const close = el(doc, "button", "kai-close");
  close.type = "button";
  close.setAttribute("aria-label", t("kaiClose", "Close"));
  close.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
  card.append(close, say, actions);

  const button = el(doc, "button", "kai-button");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "kai-card");
  button.setAttribute("aria-label", t("kaiOpen", "Ask Kai"));
  button.title = t("kaiOpen", "Ask Kai");
  button.append(kaiFace(doc));
  root.append(card, button);
  doc.body.append(root);

  const isOpen = () => !card.hidden;
  const actionButton = (label: [string, string], run: () => void, primary = false) => {
    const b = el(doc, "button", primary ? "kai-act primary" : "kai-act", t(label[0], label[1]));
    b.type = "button";
    b.addEventListener("click", () => {
      hide();
      run();
    });
    return b;
  };

  const fill = () => {
    if (options.isOff()) {
      say.textContent = t("kaiOff", "Moat is off right now, so ads and trackers load on every site.");
      actions.replaceChildren(actionButton(["kaiTurnOn", "Turn Moat on"], options.turnOn, true), actionButton(["kaiAllHelp", "All help"], options.openHelp));
      return;
    }
    const line = options.lines[options.currentScreen()] ?? options.lines.overview!;
    say.textContent = t(line.say[0], line.say[1]);
    actions.replaceChildren(
      ...line.actions.map((a, i) => actionButton(a.label, a.run, i === 0)),
      actionButton(["kaiAllHelp", "All help"], options.openHelp)
    );
  };

  const show = () => {
    fill();
    card.hidden = false;
    root.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    (actions.querySelector("button") as HTMLButtonElement | null)?.focus();
  };
  const hide = () => {
    if (card.hidden) return;
    card.hidden = true;
    root.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", () => (isOpen() ? hide() : show()));
  close.addEventListener("click", () => {
    hide();
    button.focus();
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      hide();
      button.focus();
    }
  });
  doc.addEventListener("click", (event) => {
    if (isOpen() && !root.contains(event.target as Node)) hide();
  });
  // A new screen gets its own line next time Kai is opened.
  (doc.defaultView ?? window).addEventListener("hashchange", hide);

  return { open: show, close: hide, isOpen };
}

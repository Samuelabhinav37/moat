// Kai, Moat's guide, in the bottom-right corner of Settings (as on the
// website). Pressing Kai opens a card of plain questions ("How do I pause
// Moat on a site?"). Picking one makes Kai answer in a sentence or two and
// takes you there: the right screen opens and the control is outlined for
// a moment. When protection is off, Kai says so first. Kai is the only
// Kai on the page: it hides while the "How it works" drawer (where Kai
// explains the picture) or Help is open. Kai blinks but doesn't float: a
// looping float made Settings stutter (see the note in options.css).
import type { Translate } from "./overviewView";

export interface KaiQuestion {
  id: string;
  ask: [string, string];
  answer: [string, string];
  /** Where to take the reader: a hash to open, then an element to outline. */
  hash?: string;
  target?: string;
  /** Instead of taking you somewhere, do this (open a help topic). */
  run?: () => void;
}

export interface KaiOptions {
  t: Translate;
  currentScreen: () => string;
  isOff: () => boolean;
  turnOn: () => void;
  openHelp: () => void;
  questions: KaiQuestion[];
  /** Question ids to list first on each screen. */
  firstOn: Record<string, string[]>;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Kai with two eyelids that blink (decoration only). */
function kaiFace(doc: Document): HTMLElement {
  const face = el(doc, "span", "kai-face");
  face.setAttribute("aria-hidden", "true");
  const img = el(doc, "img");
  img.src = "characters/kai.webp";
  img.alt = "";
  face.append(img, el(doc, "i", "lid l"), el(doc, "i", "lid r"));
  return face;
}

/** Scrolls an element into view and outlines it for a moment. */
export function pointAt(doc: Document, selector: string): boolean {
  const target = Array.from(doc.querySelectorAll<HTMLElement>(selector)).find((node) => !node.closest(".dash-off, [hidden]"));
  if (!target) return false;
  const reduced = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  target.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "center" });
  target.classList.remove("kai-here");
  void target.offsetWidth;
  target.classList.add("kai-here");
  doc.defaultView?.setTimeout(() => target.classList.remove("kai-here"), 2600);
  return true;
}

export function initKaiGuide(doc: Document, options: KaiOptions): { open: () => void; close: () => void; isOpen: () => boolean } {
  const { t } = options;
  const win = doc.defaultView ?? window;
  const root = el(doc, "div", "kai-guide");
  const card = el(doc, "div", "kai-card");
  card.id = "kai-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", t("kaiOpen", "Ask Kai"));
  const say = el(doc, "p", "kai-say");
  say.setAttribute("aria-live", "polite");
  const list = el(doc, "div", "kai-list");
  const close = el(doc, "button", "kai-close");
  close.type = "button";
  close.setAttribute("aria-label", t("kaiClose", "Close"));
  close.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
  card.append(close, say, list);

  const button = el(doc, "button", "kai-button");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "kai-card");
  button.setAttribute("aria-label", t("kaiOpen", "Ask Kai"));
  button.title = t("kaiOpen", "Ask Kai");
  button.append(kaiFace(doc));
  // A small bubble beside Kai: the hello when Settings opens, and "Need
  // help?" when the pointer comes near. Pressing it opens the questions.
  const nudge = el(doc, "button", "kai-nudge");
  nudge.type = "button";
  nudge.hidden = true;
  root.append(card, nudge, button);
  doc.body.append(root);

  const isOpen = () => !card.hidden;
  const chip = (label: string, onClick: () => void, className = "kai-q") => {
    const b = el(doc, "button", className, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };

  const showQuestions = () => {
    if (options.isOff()) {
      say.textContent = t("kaiOff", "Moat is off right now, so ads and trackers load on every site.");
      list.replaceChildren(
        chip(t("kaiTurnOn", "Turn Moat on"), () => {
          hide();
          options.turnOn();
        }, "kai-q primary")
      );
      return;
    }
    say.textContent = t("kaiAsk", "Hi, I'm Kai. What are you looking for?");
    const first = options.firstOn[options.currentScreen()] ?? [];
    const ordered = [...options.questions].sort((a, b) => {
      const ia = first.indexOf(a.id), ib = first.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    list.replaceChildren(
      ...ordered.map((q) => chip(t(q.ask[0], q.ask[1]), () => answer(q))),
      chip(t("kaiAllHelp", "All help"), () => {
        hide();
        options.openHelp();
      }, "kai-q quiet")
    );
  };

  const answer = (q: KaiQuestion) => {
    say.textContent = t(q.answer[0], q.answer[1]);
    list.replaceChildren(chip(t("kaiAnotherQuestion", "Ask something else"), showQuestions, "kai-q quiet"));
    if (q.run) {
      hide();
      q.run();
      return;
    }
    if (q.hash && win.location.hash !== q.hash) win.location.hash = q.hash;
    if (q.target) {
      const target = q.target;
      // The screen changes on hashchange; point once it has drawn.
      win.setTimeout(() => pointAt(doc, target), 250);
    }
  };

  const show = () => {
    showQuestions();
    card.hidden = false;
    root.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    (list.querySelector("button") as HTMLButtonElement | null)?.focus();
  };
  const hide = () => {
    if (card.hidden) return;
    card.hidden = true;
    root.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  };

  let nudgeTimer = 0;
  const showNudge = (text: string, ms: number) => {
    if (isOpen()) return;
    nudge.textContent = text;
    nudge.hidden = false;
    win.clearTimeout(nudgeTimer);
    if (ms) nudgeTimer = win.setTimeout(hideNudge, ms);
  };
  const hideNudge = () => {
    nudge.hidden = true;
    win.clearTimeout(nudgeTimer);
  };
  nudge.addEventListener("click", () => {
    hideNudge();
    show();
  });
  // Hello: Kai smiles and says hi once, as Settings opens.
  const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  win.setTimeout(() => {
    root.classList.add("happy");
    if (!reduced) root.classList.add("hello");
    showNudge(t("kaiHello", "Hi! I'm Kai. Ask me if you need anything."), 4200);
    win.setTimeout(() => root.classList.remove("happy", "hello"), 2200);
  }, 700);
  // Near: when the pointer comes within reach, Kai offers help. Checked at
  // most once a frame, and only reads Kai's own box.
  let near = false;
  let pending = false;
  let px = 0;
  let py = 0;
  doc.addEventListener("pointermove", (event) => {
    px = event.clientX;
    py = event.clientY;
    if (pending) return;
    pending = true;
    win.requestAnimationFrame(() => {
      pending = false;
      if (isOpen()) return;
      const box = button.getBoundingClientRect();
      const d = Math.hypot(px - (box.left + box.width / 2), py - (box.top + box.height / 2));
      if (!near && d < 170) {
        near = true;
        root.classList.add("happy");
        showNudge(t("kaiNeedHelp", "Need help?"), 0);
      } else if (near && d > 260) {
        near = false;
        root.classList.remove("happy");
        hideNudge();
      }
    });
  }, { passive: true });

  button.addEventListener("click", () => {
    hideNudge();
    if (isOpen()) hide();
    else show();
  });
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
  // composedPath, not contains: a question's button is replaced by the
  // answer before the click reaches the document.
  doc.addEventListener("click", (event) => {
    if (isOpen() && !event.composedPath().includes(root)) hide();
  });

  return { open: show, close: hide, isOpen };
}

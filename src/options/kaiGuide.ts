// Kai, Moat's guide, in the bottom-right corner of Settings (as on the
// website), with "Ask Kai" in a small bubble above it. Pressing Kai opens a
// chat of plain questions ("How do I pause Moat on a site?"); there is no
// text box, so every question has an answer. Kai answers in a sentence or
// two and offers "Show me": the right screen opens and the control is
// outlined for a moment. When protection is off, Kai says so first.
//
// Kai is the live, front-facing Kai (../ui/kai/kaiLife.js) in calm mode: it
// blinks, glances, follows the pointer when it comes near and reacts while
// answering, but draws no frames while still (a looping float made
// Settings stutter, see options.css). It is the only Kai on the page: it
// hides while the "How it works" drawer (where Kai explains the picture) or
// Help is open. DOM calls only.
import "../ui/kai/kaiLife.js";
import type { KaiInstance } from "../ui/kai/kaiLife";
import type { Translate } from "./overviewView";

export interface KaiQuestion {
  id: string;
  ask: [string, string];
  answer: [string, string];
  /** Where "Show me" takes the reader: a hash to open, then an element to outline. */
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

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function closeIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M5 5l10 10M15 5L5 15");
  svg.append(path);
  return svg;
}

/** A Kai that does nothing, where the engine can't run (tests without it). */
const STILL_KAI: Omit<KaiInstance, "root"> = {
  mood: "neutral", thinking: false,
  setMood() {}, do() {}, blink() {}, lookAt() {}, talk() {}, think() {}, lightAntenna() {}, react() {},
};

/** The live Kai inside `host`, or a still one if the engine isn't there. */
export function makeKai(host: HTMLElement, imgWidth: 160 | 320 | 640 = 320): KaiInstance {
  const factory = host.ownerDocument.defaultView?.Kai;
  return factory ? factory(host, { src: "characters/", imgWidth, calm: true }) : { ...STILL_KAI, root: host };
}

/** Scroll to `selector` and outline it briefly (the ring Kai leaves). */
export function pointAt(doc: Document, selector: string): boolean {
  const target = doc.querySelector<HTMLElement>(selector);
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
  const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const wait = (ms: number) => (reduced ? 0 : ms);
  const byId = new Map(options.questions.map((q) => [q.id, q]));

  const root = el(doc, "div", "kai-guide");
  // The chat: header (name, status, close) and the conversation.
  const panel = el(doc, "section", "kg-panel");
  panel.id = "kai-card";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("kaiOpen", "Ask Kai"));
  const head = el(doc, "header", "kg-head");
  const name = el(doc, "div", "kg-name", "Kai");
  const statusText = t("kaiStatus", "Here to help with Moat");
  const status = el(doc, "div", "kg-status", statusText);
  const close = el(doc, "button", "kg-close");
  close.type = "button";
  close.setAttribute("aria-label", t("kaiClose", "Close"));
  close.append(closeIcon(doc));
  const id = el(doc, "div", "kg-id");
  id.append(name, status);
  head.append(id, close);
  const body = el(doc, "div", "kg-body");
  const log = el(doc, "div", "kg-log");
  log.setAttribute("aria-live", "polite");
  body.append(log);
  panel.append(head, body);

  // Kai in the corner with "Ask Kai" above it; the bubble also carries the
  // hello when Settings opens and "Need help?" when the pointer comes near.
  const launch = el(doc, "div", "kg-launch");
  const tag = el(doc, "button", "kg-tag", t("kaiOpen", "Ask Kai"));
  tag.type = "button";
  tag.tabIndex = -1;
  tag.setAttribute("aria-hidden", "true");
  const button = el(doc, "button", "kai-button");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "kai-card");
  button.setAttribute("aria-label", t("kaiOpen", "Ask Kai"));
  const kaiHost = el(doc, "span", "kg-kai");
  button.append(kaiHost);
  launch.append(tag, button);
  root.append(panel, launch);
  doc.body.append(root);
  const kai = makeKai(kaiHost);

  const isOpen = () => !panel.hidden;
  const scrollDown = () => { body.scrollTop = body.scrollHeight; };
  let busy = false;
  const asked = new Set<string>();

  const bubble = (who: "me" | "kai", text = "") => {
    const m = el(doc, "div", `kg-msg kg-${who}`, text);
    log.append(m);
    scrollDown();
    return m;
  };
  const chip = (label: string, onClick: () => void, className = "kai-q") => {
    const b = el(doc, "button", className, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  const action = (label: string, run: () => void) => {
    const b = el(doc, "button", "kg-go", `${label} →`);
    b.type = "button";
    b.addEventListener("click", () => {
      hide();
      run();
    });
    return b;
  };

  /** Kai says `text` (typed out while its mouth moves), then `then()`. */
  const say = (text: string, extra: HTMLElement | null, then: () => void) => {
    kai.react("found", text.length);
    const m = bubble("kai");
    let i = 0;
    const step = () => {
      i = reduced ? text.length : Math.min(text.length, i + 2);
      m.textContent = text.slice(0, i);
      scrollDown();
      if (i < text.length) {
        win.setTimeout(step, 16);
        return;
      }
      if (extra) m.append(extra);
      scrollDown();
      then();
    };
    step();
  };

  const choices = (ids: string[], more: boolean, help: boolean) => {
    const wrap = el(doc, "div", "kai-list");
    for (const qid of ids) {
      const q = byId.get(qid);
      if (q) wrap.append(chip(t(q.ask[0], q.ask[1]), () => ask(q, wrap)));
    }
    if (more) {
      const rest = options.questions.map((q) => q.id).filter((qid) => !ids.includes(qid));
      if (rest.length) wrap.append(chip(t("kaiAnotherQuestion", "Ask something else"), () => {
        wrap.remove();
        choices(rest, false, true);
      }, "kai-q quiet"));
    }
    if (help) wrap.append(chip(t("kaiAllHelp", "All help"), () => {
      hide();
      options.openHelp();
    }, "kai-q quiet"));
    log.append(wrap);
    scrollDown();
    return wrap;
  };

  const firstIds = () => {
    const first = options.firstOn[options.currentScreen()] ?? [];
    return [...options.questions].sort((a, b) => {
      const ia = first.indexOf(a.id), ib = first.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }).map((q) => q.id).slice(0, 4);
  };

  const ask = (q: KaiQuestion, wrap: HTMLElement) => {
    if (busy) return;
    busy = true;
    asked.add(q.id);
    wrap.remove();
    bubble("me", t(q.ask[0], q.ask[1]));
    const typing = el(doc, "div", "kg-msg kg-kai typing");
    typing.append(el(doc, "i"), el(doc, "i"), el(doc, "i"));
    log.append(typing);
    scrollDown();
    root.classList.add("thinking");
    status.textContent = t("kaiThinking", "Thinking");
    kai.think(true);
    win.setTimeout(() => {
      typing.remove();
      root.classList.remove("thinking");
      status.textContent = statusText;
      kai.think(false);
      const go = q.run
        ? action(t("kaiStart", "Start"), q.run)
        : q.hash || q.target
          ? action(t("kaiShowMe", "Show me"), () => {
              if (q.hash && win.location.hash !== q.hash) win.location.hash = q.hash;
              const target = q.target;
              // The screen changes on hashchange; point once it has drawn.
              if (target) win.setTimeout(() => pointAt(doc, target), 250);
            })
          : null;
      say(t(q.answer[0], q.answer[1]), go, () => {
        busy = false;
        const next = options.questions.map((o) => o.id).filter((qid) => !asked.has(qid)).slice(0, 3);
        choices(next, true, false);
      });
    }, wait(560));
  };

  const greet = () => {
    busy = true;
    if (options.isOff()) {
      say(t("kaiOff", "Moat is off right now, so ads and trackers load on every site."), action(t("kaiTurnOn", "Turn Moat on"), options.turnOn), () => {
        busy = false;
        choices(firstIds(), true, true);
      });
      return;
    }
    say(t("kaiAsk", "Hi, I'm Kai. What are you looking for?"), null, () => {
      busy = false;
      choices(firstIds(), true, true);
    });
  };

  const show = () => {
    if (isOpen()) return;
    panel.hidden = false;
    root.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    hideNudge();
    kai.do("wave");
    // Each time it opens, Kai starts afresh with this screen's questions.
    log.replaceChildren();
    asked.clear();
    busy = false;
    greet();
    win.setTimeout(() => panel.querySelector<HTMLButtonElement>(".kai-q, .kg-go")?.focus(), wait(400));
  };
  const hide = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    root.classList.remove("open", "thinking");
    button.setAttribute("aria-expanded", "false");
    kai.think(false);
    status.textContent = statusText;
  };

  let nudgeTimer = 0;
  const showNudge = (text: string, ms: number) => {
    if (isOpen()) return;
    tag.textContent = text;
    root.classList.add("nudging");
    win.clearTimeout(nudgeTimer);
    if (ms) nudgeTimer = win.setTimeout(hideNudge, ms);
  };
  const hideNudge = () => {
    tag.textContent = t("kaiOpen", "Ask Kai");
    root.classList.remove("nudging");
    win.clearTimeout(nudgeTimer);
  };
  tag.addEventListener("click", show);
  // Hello: Kai smiles, waves and says hi once, as Settings opens.
  win.setTimeout(() => {
    kai.setMood("happy", 2200);
    kai.do("wave");
    showNudge(t("kaiHello", "Hi! I'm Kai. Ask me if you need anything."), 4200);
  }, 700);
  // Near: when the pointer comes within reach, Kai looks at it and offers
  // help. Checked at most once a frame, and only reads Kai's own box.
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
      const box = button.getBoundingClientRect();
      const d = Math.hypot(px - (box.left + box.width / 2), py - (box.top + box.height / 2));
      if (d < 420) kai.lookAt({ x: px, y: py });
      else kai.lookAt(null);
      if (isOpen()) return;
      if (!near && d < 170) {
        near = true;
        kai.setMood("happy", 1500);
        showNudge(t("kaiNeedHelp", "Need help?"), 0);
      } else if (near && d > 260) {
        near = false;
        hideNudge();
      }
    });
  }, { passive: true });
  button.addEventListener("pointerenter", () => {
    if (!isOpen()) kai.do("hop");
  });

  button.addEventListener("click", () => {
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
  // composedPath, not contains: a question's button is removed by the
  // answer before the click reaches the document.
  doc.addEventListener("click", (event) => {
    if (isOpen() && !event.composedPath().includes(root)) hide();
  });

  return { open: show, close: hide, isOpen };
}

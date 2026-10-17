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
//
// The bubble above Kai floats on its own, pinned over Kai's right edge
// (options.css), so a long hello grows it up and to the left and Kai never
// moves. When it shows is kaiWatch.js's call: the hello once per visit,
// then "Ask Kai", then it folds away and only comes back when you look
// stuck (rage or dead clicks, back and forth between screens, flipping a
// switch, hunting without clicking), or as "Need help?" when the pointer
// comes near Kai.
import "../ui/kai/kaiLife.js";
import "../ui/kai/kaiWatch.js";
import type { KaiInstance } from "../ui/kai/kaiLife";
import type { KaiNudgeKind, KaiWatch } from "../ui/kai/kaiWatch";
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
  setMood() {}, do() {}, blink() {}, lookAt() {}, pointAt() {}, talk() {}, think() {}, lightAntenna() {}, react() {},
};

/** The live Kai inside `host`, or a still one if the engine isn't there. */
export function makeKai(host: HTMLElement, imgWidth: 160 | 320 | 640 = 320): KaiInstance {
  const factory = host.ownerDocument.defaultView?.Kai;
  return factory ? factory(host, { src: "characters/", imgWidth, calm: true }) : { ...STILL_KAI, root: host };
}

/** Scroll to `selector` and outline it briefly (the ring Kai leaves).
 * With `kai`, Kai first looks at the spot and leans its antenna toward it,
 * and the ring follows a beat later (anticipation, then the action). */
export function pointAt(doc: Document, selector: string, kai?: KaiInstance): boolean {
  const target = doc.querySelector<HTMLElement>(selector);
  if (!target) return false;
  const win = doc.defaultView;
  const reduced = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  target.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "center" });
  const ring = () => {
    target.classList.remove("kai-here");
    void target.offsetWidth;
    target.classList.add("kai-here");
    win?.setTimeout(() => target.classList.remove("kai-here"), 2600);
  };
  if (!kai || reduced || !win) { ring(); return true; }
  win.setTimeout(() => kai.pointAt(target), 380);
  win.setTimeout(ring, 680);
  return true;
}

/** Things that happened in Settings that Kai reacts to (kai-character.md). */
export type KaiMoment = { name: "off" } | { name: "on" } | { name: "paused" } | { name: "milestone"; count: number };

export interface KaiGuide {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  watch: KaiWatch | undefined;
  /** Kai reacts, and says a short line when it can. */
  moment: (m: KaiMoment) => void;
  /** Protection on or off, as the Overview banner shows it. The first call
   * only sets Kai's face; a change after that is a moment. */
  protection: (off: boolean) => void;
}

export function initKaiGuide(doc: Document, options: KaiOptions): KaiGuide {
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

  // Kai in the corner with the bubble above it.
  const launch = el(doc, "div", "kg-launch");
  const tag = el(doc, "button", "kg-tag");
  const tagText = el(doc, "span", "kg-tag-text", t("kaiOpen", "Ask Kai"));
  tag.append(tagText);
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
  // Narrow windows have no gutter for Kai, so it steps aside while the page
  // scrolls and comes back once it stops: whatever scrolled under its corner
  // stays reachable. Not while the chat or the bubble is open (CSS).
  const view = doc.defaultView;
  let settle: ReturnType<typeof setTimeout> | undefined;
  view?.addEventListener(
    "scroll",
    () => {
      root.classList.add("kg-away");
      clearTimeout(settle);
      settle = setTimeout(() => root.classList.remove("kg-away"), 900);
    },
    { passive: true }
  );
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
              if (target) win.setTimeout(() => pointAt(doc, target, kai), 250);
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
    hint = false;
    watch?.opened();
    tagFold();
    kai.do("wave");
    // Back within 10 minutes: the conversation is still there. Otherwise
    // Kai starts afresh with this screen's questions.
    if (log.childElementCount && Date.now() - closedAt < 10 * 60000) {
      win.setTimeout(() => panel.querySelector<HTMLButtonElement>(".kai-q, .kg-go")?.focus(), wait(400));
      return;
    }
    log.replaceChildren();
    asked.clear();
    busy = false;
    greet();
    win.setTimeout(() => panel.querySelector<HTMLButtonElement>(".kai-q, .kg-go")?.focus(), wait(400));
  };
  let closedAt = 0;
  const hide = () => {
    if (panel.hidden) return;
    closedAt = Date.now();
    panel.hidden = true;
    root.classList.remove("open", "thinking");
    button.setAttribute("aria-expanded", "false");
    kai.think(false);
    status.textContent = statusText;
  };

  // The bubble: new words fade in while the bubble eases to its new width.
  let swapTimer = 0;
  let sizeTimer = 0;
  let hint = false;
  const tagSay = (text: string) => {
    win.clearTimeout(swapTimer);
    win.clearTimeout(sizeTimer);
    if (!root.classList.contains("tag-on") || reduced) {
      tagText.textContent = text;
      tag.style.width = "";
      root.classList.add("tag-on");
      return;
    }
    if (tagText.textContent === text) return;
    tag.classList.add("swap");
    swapTimer = win.setTimeout(() => {
      const from = tag.offsetWidth;
      tag.style.width = "";
      tagText.textContent = text;
      const to = tag.offsetWidth;
      tag.style.width = `${from}px`;
      void tag.offsetWidth;
      tag.style.width = `${to}px`;
      tag.classList.remove("swap");
      sizeTimer = win.setTimeout(() => { tag.style.width = ""; }, 320);
    }, 130);
  };
  const tagFold = () => {
    win.clearTimeout(swapTimer);
    root.classList.remove("tag-on");
    tag.classList.remove("swap");
  };
  const react: Record<KaiNudgeKind, () => void> = {
    welcome: () => { kai.setMood("happy", 2200); kai.do("wave"); },
    back: () => { kai.do("peek"); },
    say: () => {},
    stuck: () => { kai.setMood("curious", 2400); kai.do("tilt"); },
    looking: () => { kai.do("lookAround"); win.setTimeout(() => { kai.lookAt(null); kai.setMood("happy", 1600); }, 900); },
    unsure: () => { kai.setMood("curious", 2400); kai.do("tilt"); },
  };
  // Help and the "How it works" drawer hide Kai (display: none in options.css)
  const hidden = () => win.getComputedStyle(root).display === "none";
  const watch = win.KaiWatch?.({
    win,
    kaiEl: root,
    isOpen: () => isOpen() || hidden(),
    show: (kind, text) => { hint = false; tagSay(text); react[kind](); },
    hide: () => { if (!hint) tagFold(); },
    text: {
      welcome: t("kaiOpen", "Ask Kai"),
      back: t("kaiBack", "Welcome back."),
      stuck: t("kaiNudgeStuck", "Hmm. Want me to take a look?"),
      looking: t("kaiNudgeLooking", "Looking for something? I know my way around."),
      unsure: t("kaiNudgeUnsure", "Not sure what that does? I can explain."),
      named: t("kaiNudgeNamed", "Need a hand with {name}?"),
    },
    sectionName: (id) => (id === "overview" ? "" : doc.querySelector(`[data-nav-link][data-page="${CSS.escape(id)}"] .nav-name`)?.textContent?.trim() ?? ""),
    storageKey: "moat-kai-watch",
  });
  const onScreen = () => watch?.section(options.currentScreen());
  onScreen();
  win.addEventListener("hashchange", () => win.setTimeout(onScreen, 50));
  tag.addEventListener("click", show);
  // Hello: at most once a day Kai smiles, waves and says hi (or says Moat
  // is off, if it is); then the bubble says "Ask Kai" for a moment and folds
  // away. A later day gets "Welcome back.", the same day nothing.
  win.setTimeout(() => {
    if (!watch) return tagSay(t("kaiOpen", "Ask Kai"));
    const hello = options.isOff()
      ? t("kaiOff", "Heads up. Moat is off, so ads and trackers are getting through.")
      : t("kaiHello", "Hi, I'm Kai. I'm small, but I know Moat inside out.");
    if (watch.welcome(hello, 8000) !== "welcome") return;
    win.setTimeout(() => { if (watch.isShowing() === "welcome") tagSay(t("kaiOpen", "Ask Kai")); }, 4200);
  }, 700);
  // Near: when the pointer comes within reach, Kai looks at it and offers
  // help (not counted as a nudge). Checked at most once a frame, and only
  // reads Kai's own box.
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
        if (!watch?.isShowing()) {
          hint = true;
          kai.setMood("happy", 1500);
          tagSay(t("kaiNeedHelp", "Need a hand?"));
        }
      } else if (near && d > 260) {
        near = false;
        if (hint) { hint = false; tagFold(); }
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

  // "Got it": a small nod when a setting changes, once per control per visit.
  const nodded = new Set<string>();
  const gotIt = (control: Element | null) => {
    if (!control || root.contains(control) || isOpen()) return;
    const id = control.id || control.getAttribute("name") || control.getAttribute("aria-label") || "";
    if (!id || nodded.has(id)) return;
    nodded.add(id);
    kai.do("nodSmall");
  };
  doc.addEventListener("change", (event) => {
    if (event.isTrusted) gotIt(event.target as Element | null);
  });
  doc.addEventListener("click", (event) => {
    if (event.isTrusted) gotIt((event.target as Element | null)?.closest?.('[role="switch"]') ?? null);
  });

  const lines: Record<KaiMoment["name"], (m: KaiMoment) => string> = {
    off: () => t("kaiOff", "Heads up. Moat is off, so ads and trackers are getting through."),
    on: () => t("kaiMomentOn", "Back on guard."),
    paused: () => t("kaiMomentPaused", "Paused. I'll look away there."),
    milestone: (m) => {
      const count = m.name === "milestone" ? m.count.toLocaleString() : "";
      return t("kaiMomentMilestone", `That's ${count} blocked this week.`, count);
    },
  };
  const moment = (m: KaiMoment) => {
    if (m.name === "off") kai.setMood("worried");
    else if (m.name === "on") { kai.setMood("neutral"); kai.do("relief"); }
    else if (m.name === "paused") kai.do("lookAway");
    else { kai.do("puff"); kai.lightAntenna(1800); }
    // the words come once the move has started (relief is a breath out first)
    win.setTimeout(() => { hint = false; watch?.say(lines[m.name](m)); }, m.name === "on" ? wait(500) : 0);
  };
  let protectionOff: boolean | null = null;
  const protection = (off: boolean) => {
    if (protectionOff === off) return;
    const first = protectionOff === null;
    protectionOff = off;
    if (first) { if (off) kai.setMood("worried"); return; }
    moment({ name: off ? "off" : "on" });
  };

  return { open: show, close: hide, isOpen, watch, moment, protection };
}

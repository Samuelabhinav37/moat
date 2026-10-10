// Help, opened from the top bar: a panel at the right edge (the way
// Atlassian and Salesforce do in-product help) with the topic for the
// screen you're on first, then "Fix a problem" and "Learn". Each topic is a
// short story: one idea per step, a caption of a few words, Back/Next, and
// numbered steps that tick off. It plays once by itself, pauses while the
// pointer is over it, and never moves under reduced motion. DOM calls only.
import type { Translate } from "./overviewView";

type Scene = (doc: Document) => HTMLElement;

export interface Topic {
  id: string;
  icon: string;
  title: [string, string];
  sub: [string, string];
  steps: [string, string, Scene][];
  fix?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
// Line icons on a 24px grid, same family as the rest of Settings.
const ICONS: Record<string, string> = {
  reload: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  key: "M8 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM10.5 12.5 19 4M16 7l2 2M13.8 9.2l2 2",
  play: "M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2ZM10.5 9.5v5l4-2.5z",
  hidden: "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 4l16 16",
  warn: "M12 4l9 16H3zM12 10v4M12 17v.3",
  book: "M5 4.5h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17.5a3 3 0 0 1 3-3h10",
  check: "M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l4 4M8.5 11l2 2 3.5-4",
  lock: "M7 10.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM8 10.5V8a4 4 0 0 1 8 0v2.5",
  shield: "M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6z",
};
function svgIcon(doc: Document, name: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name] ?? ICONS.book!);
  svg.append(path);
  return svg;
}

// ---------- Scene parts (CSS animates them; see .hp- rules in options.html) ----------
const page = (doc: Document, extra?: HTMLElement): HTMLElement => {
  const w = el(doc, "div", "hp-win hp-pop");
  const bar = el(doc, "div", "hp-bar");
  bar.append(el(doc, "i"), el(doc, "i"), el(doc, "i"));
  w.append(bar);
  if (extra) w.append(extra);
  else for (const width of ["60%", "90%", "40%"]) {
    const line = el(doc, "div", "hp-line");
    line.style.width = width;
    w.append(line);
  }
  return w;
};
const spinner: Scene = (doc) => {
  const box = el(doc, "div", "hp-center");
  box.append(el(doc, "div", "hp-spin"));
  return page(doc, box);
};
const toggleOff = (key: string, fallback: string) => (doc: Document, t?: Translate) => {
  const row = el(doc, "div", "hp-row hp-pop");
  row.append(el(doc, "span", "hp-toggle"), el(doc, "b", "", t ? t(key, fallback) : fallback));
  return row;
};
const icon = (cls: string, name: string): Scene => (doc) => {
  const box = el(doc, "div", `hp-big hp-pop ${cls}`);
  if (name) box.append(svgIcon(doc, name));
  return box;
};
const done: Scene = (doc) => el(doc, "div", "hp-done hp-pop", "✓");
const reload: Scene = (doc) => {
  const box = el(doc, "div", "hp-reload");
  box.append(svgIcon(doc, "reload"));
  return box;
};
const lane: Scene = (doc) => {
  const wrap = el(doc, "div", "hp-lane");
  wrap.append(page(doc));
  for (let i = 0; i < 4; i++) {
    const dot = el(doc, "span", i % 2 ? "hp-req no" : "hp-req ok");
    dot.style.setProperty("--i", String(i));
    wrap.append(dot);
  }
  wrap.append(el(doc, "span", "hp-shield", "✓"));
  return wrap;
};
const fanout: Scene = (doc) => {
  const wrap = el(doc, "div", "hp-fan");
  wrap.append(page(doc));
  for (let i = 0; i < 8; i++) {
    const dot = el(doc, "span", i % 2 ? "hp-orbit no" : "hp-orbit ok");
    dot.style.setProperty("--a", `${i * 45}deg`);
    dot.style.setProperty("--i", String(i));
    wrap.append(dot);
  }
  return wrap;
};
const adCloses: Scene = (doc) => {
  const body = el(doc, "div");
  const l1 = el(doc, "div", "hp-line");
  l1.style.width = "60%";
  const l2 = el(doc, "div", "hp-line");
  l2.style.width = "85%";
  body.append(l1, el(doc, "div", "hp-ad", "AD"), l2);
  return page(doc, body);
};
const address: Scene = (doc) => {
  const bar = el(doc, "div", "hp-addr hp-pop");
  bar.append(svgIcon(doc, "lock"), doc.createTextNode("surveymonkey.com"));
  return bar;
};
const button = (key: string, fallback: string, primary = false) => (doc: Document, t?: Translate) =>
  el(doc, "span", `hp-btn hp-pop${primary ? " primary" : ""}`, t ? t(key, fallback) : fallback);
const score: Scene = (doc) => {
  const box = el(doc, "div", "hp-score");
  box.append(el(doc, "b", "", "130 / 131"));
  const meter = el(doc, "span", "hp-meter");
  meter.append(el(doc, "i"));
  box.append(meter);
  return box;
};
const netlog = (blocked: boolean): Scene => (doc) => {
  const log = el(doc, "div", "hp-net hp-pop");
  const rows: [string, string, boolean][] = [
    ["news.example", "200", false],
    ["securepubads.g.doubleclick.net", blocked ? "blocked" : "…", blocked],
    ["google-analytics.com/collect", blocked ? "blocked" : "…", blocked],
  ];
  rows.forEach(([url, status, bad], i) => {
    const row = el(doc, "div", bad ? "blk" : "");
    row.style.setProperty("--i", String(i));
    row.append(el(doc, "span", "", url), el(doc, "span", "", status));
    log.append(row);
  });
  return log;
};

export const TOPICS: Topic[] = [
  {
    id: "load", icon: "reload", fix: true, title: ["helpLoadTitle", "Page won't load"], sub: ["helpLoadSub", "Or loads very slowly"],
    steps: [["helpStepStuck", "Page stuck loading", spinner], ["helpStepOffHere", "Pause Moat on this site", toggleOff("helpToggleLabel", "Moat on this site")], ["helpStepReload", "Reload the page", reload], ["helpStepWorksReport", "Works? Report the site", done]],
  },
  {
    id: "signin", icon: "key", fix: true, title: ["helpSigninTitle", "Can't sign in"], sub: ["helpSigninSub", "Sign-in window or CAPTCHA"],
    steps: [["helpStepNoWindow", "Sign-in window didn't open", spinner], ["helpStepClickIcon", "Click the Moat icon", icon("hp-logo", "")], ["helpStepAllowPopups", "Allow pop-ups here", toggleOff("helpTogglePopups", "Block pop-ups here")], ["helpStepSignInAgain", "Sign in again", done]],
  },
  {
    id: "video", icon: "play", fix: true, title: ["helpVideoTitle", "Video won't play"], sub: ["helpVideoSub", "Or the player is blank"],
    steps: [["helpStepNoVideo", "Video won't play", icon("hp-warn", "play")], ["helpStepOffHere", "Pause Moat on this site", toggleOff("helpToggleLabel", "Moat on this site")], ["helpStepReload", "Reload the page", reload], ["helpStepWorksReport", "Works? Report the site", done]],
  },
  {
    id: "missing", icon: "hidden", fix: true, title: ["helpMissingTitle", "Something's missing"], sub: ["helpMissingSub", "A button or section is gone"],
    steps: [["helpStepGone", "Part of the page is gone", adCloses], ["helpStepOpenHidden", "Open Exceptions › Hidden", icon("hp-pink", "hidden")], ["helpStepShowAgain", "Press Show again", button("helpShowAgainButton", "Show again")], ["helpStepBack", "It's back", done]],
  },
  {
    id: "danger", icon: "warn", fix: true, title: ["helpDangerTitle", "Real site blocked"], sub: ["helpDangerSub", "Stopped by mistake"],
    steps: [["helpStepBlocked", "A real site is blocked", icon("hp-red", "warn")], ["helpStepCheckAddress", "Check the address", address], ["helpStepPause", "Pause Moat on that site", toggleOff("helpToggleLabel", "Moat on this site")], ["helpStepReportFix", "Report it so we fix it", done]],
  },
  {
    id: "how", icon: "book", title: ["helpHowTitle", "How Moat works"], sub: ["helpHowSub", "Five short steps"],
    steps: [["helpStepOpenPage", "You open a page", (d) => page(d)], ["helpStepCalls", "It calls dozens of servers", fanout], ["helpStepStops", "Moat stops the trackers", lane], ["helpStepGaps", "Ad gaps close up", adCloses], ["helpStepDevice", "All on your device", icon("hp-blue", "lock")]],
  },
  {
    id: "verify", icon: "check", title: ["helpVerifyTitle", "Check Moat yourself"], sub: ["helpVerifySub", "Test page and DevTools"],
    steps: [["helpStepTestPage", "Open the test page", (d) => page(d)], ["helpStepScore", "Watch the score", score], ["helpStepDevtools", "Press F12, then Network", netlog(false)], ["helpStepRedRows", "Blocked rows say so", netlog(true)]],
  },
];

/** Which topic each screen shows first. */
export const CONTEXT: Record<string, string> = {
  overview: "how", protection: "signin", exceptions: "missing", trackers: "how", sites: "load", security: "danger", about: "verify",
};

export interface HelpOptions {
  t: Translate;
  currentScreen: () => string;
  /** Opens the problem report (report.html). */
  report: () => void;
  docsUrl: string;
  testPageUrl: string;
}

export function initHelpPanel(doc: Document, options: HelpOptions): { open: () => void; close: () => void; isOpen: () => boolean; openTopic: (id: string) => void } {
  const { t } = options;
  const win = doc.defaultView ?? window;
  const panel = doc.getElementById("help-panel")!;
  const body = panel.querySelector<HTMLElement>(".hp-body")!;
  const button = doc.getElementById("help-button") as HTMLButtonElement;
  const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let topicId: string | null = null;

  const isOpen = () => !panel.hidden;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  const topicButton = (topic: Topic, here = false) => {
    const b = el(doc, "button", here ? "hp-topic here" : "hp-topic");
    b.type = "button";
    const text = el(doc, "span");
    text.append(el(doc, "b", "", t(topic.title[0], topic.title[1])), el(doc, "small", "", t(topic.sub[0], topic.sub[1])));
    const ti = el(doc, "span", "hp-ti");
    ti.append(svgIcon(doc, topic.icon));
    b.append(ti, text, el(doc, "span", "hp-go", "›"));
    b.addEventListener("click", () => showTopic(topic.id));
    return b;
  };

  const showList = () => {
    stop();
    topicId = null;
    const first = TOPICS.find((x) => x.id === CONTEXT[options.currentScreen()]) ?? TOPICS[0]!;
    const group = (title: string, topics: Topic[]) => {
      const g = el(doc, "div", "hp-group");
      g.append(el(doc, "div", "hp-h", title), ...topics.map((x) => topicButton(x)));
      return g;
    };
    const here = el(doc, "div", "hp-group");
    here.append(el(doc, "div", "hp-h", t("helpForThisPage", "For this page")), topicButton(first, true));
    // A filter over every topic, its steps included (Stripe's and GitHub's
    // in-product help both lead with one).
    const search = el(doc, "input", "hp-search");
    search.type = "search";
    search.placeholder = t("helpSearch", "Search help");
    search.setAttribute("aria-label", t("helpSearch", "Search help"));
    const topics = el(doc, "div", "hp-results");
    const words = (topic: Topic) =>
      [t(topic.title[0], topic.title[1]), t(topic.sub[0], topic.sub[1]), ...topic.steps.map(([key, fallback]) => t(key, fallback))].join(" ").toLowerCase();
    const browse = () => [
      here,
      group(t("helpFixGroup", "Fix a problem"), TOPICS.filter((x) => x.fix && x.id !== first.id)),
      group(t("helpLearnGroup", "Learn"), TOPICS.filter((x) => !x.fix && x.id !== first.id)),
    ];
    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      if (!query) return topics.replaceChildren(...browse());
      const found = TOPICS.filter((topic) => query.split(/\s+/).every((word) => words(topic).includes(word)));
      topics.replaceChildren(
        found.length ? group(t("helpResults", "Results"), found) : el(doc, "p", "hp-none", t("helpNoResults", "No help topic matches. Try other words, or report the problem below."))
      );
    });
    topics.append(...browse());
    const links = el(doc, "div", "hp-links");
    const docs = el(doc, "a", "", t("helpFullDocs", "Full documentation"));
    docs.href = options.docsUrl;
    docs.target = "_blank";
    docs.rel = "noopener";
    const report = el(doc, "button", "linklike", t("helpReportProblem", "Report a problem"));
    report.type = "button";
    report.addEventListener("click", options.report);
    links.append(docs, report);
    body.replaceChildren(search, topics, links);
  };

  const showTopic = (id: string) => {
    stop();
    topicId = id;
    const topic = TOPICS.find((x) => x.id === id)!;
    let step = 0;
    const back = el(doc, "button", "hp-back", `‹ ${t("helpAllHelp", "All help")}`);
    back.type = "button";
    back.addEventListener("click", showList);
    const stage = el(doc, "div", "hp-stage");
    const caption = el(doc, "p", "hp-cap");
    caption.setAttribute("aria-live", "polite");
    const pips = el(doc, "div", "hp-pips");
    const prev = el(doc, "button", "hp-nav", t("helpBack", "Back"));
    const next = el(doc, "button", "hp-nav primary", t("helpNext", "Next"));
    prev.type = next.type = "button";
    const list = el(doc, "ol", "hp-steps");
    const scenes = topic.steps.map(([, , scene]) => {
      const holder = el(doc, "div", "hp-scene");
      holder.append((scene as (d: Document, t?: Translate) => HTMLElement)(doc, t));
      return holder;
    });
    stage.append(...scenes);
    const dots = topic.steps.map((_, i) => {
      const d = el(doc, "button", "hp-pip");
      d.type = "button";
      d.setAttribute("aria-label", t("helpStepN", `Step ${i + 1}`, String(i + 1)));
      d.addEventListener("click", () => {
        stop();
        go(i);
      });
      return d;
    });
    pips.append(...dots);
    const items = topic.steps.map(([key, fallback]) => el(doc, "li", "", t(key, fallback)));
    list.append(...items);
    const go = (n: number) => {
      step = (n + topic.steps.length) % topic.steps.length;
      scenes.forEach((s, i) => s.classList.toggle("on", i === step));
      dots.forEach((d, i) => d.setAttribute("aria-current", String(i === step)));
      items.forEach((li, i) => (li.className = i < step ? "done" : i === step ? "cur" : ""));
      caption.replaceChildren(el(doc, "span", "hp-n", `${step + 1}/${topic.steps.length}`), doc.createTextNode(t(topic.steps[step]![0], topic.steps[step]![1])));
      prev.disabled = step === 0;
      next.textContent = step === topic.steps.length - 1 ? t("helpReplay", "Replay") : t("helpNext", "Next");
    };
    prev.addEventListener("click", () => {
      stop();
      go(step - 1);
    });
    next.addEventListener("click", () => {
      stop();
      go(step === topic.steps.length - 1 ? 0 : step + 1);
    });
    const controls = el(doc, "div", "hp-controls");
    const buttons = el(doc, "div", "hp-buttons");
    buttons.append(prev, next);
    controls.append(pips, buttons);
    const parts: HTMLElement[] = [back, el(doc, "h3", "hp-title", t(topic.title[0], topic.title[1])), stage, caption, controls, list];
    if (topic.fix) {
      const still = el(doc, "div", "hp-still");
      const reportBtn = el(doc, "button", "primary", t("helpReportSite", "Report this site"));
      reportBtn.type = "button";
      reportBtn.addEventListener("click", options.report);
      still.append(el(doc, "div", "hp-h", t("helpStillBroken", "Still not working?")), reportBtn);
      parts.push(still);
    }
    if (topic.id === "verify") {
      const open = el(doc, "a", "hp-btnlink", t("helpOpenTestPage", "Open the test page"));
      open.href = options.testPageUrl;
      open.target = "_blank";
      open.rel = "noopener";
      parts.push(open);
    }
    body.replaceChildren(...parts);
    body.scrollTop = 0;
    go(0);
    if (!reduced) {
      let hold = false;
      stage.addEventListener("pointerenter", () => (hold = true));
      stage.addEventListener("pointerleave", () => (hold = false));
      timer = setInterval(() => {
        if (hold) return;
        if (step >= topic.steps.length - 1) return stop();
        go(step + 1);
      }, 3200);
    }
  };

  const open = () => {
    panel.hidden = false;
    doc.body.classList.add("help-open");
    button.setAttribute("aria-expanded", "true");
    showList();
    panel.querySelector<HTMLElement>(".hp-close")?.focus();
  };
  const close = () => {
    stop();
    panel.hidden = true;
    doc.body.classList.remove("help-open");
    button.setAttribute("aria-expanded", "false");
    button.focus();
  };
  button.addEventListener("click", () => (isOpen() ? close() : open()));
  panel.querySelector(".hp-close")?.addEventListener("click", close);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) close();
  });
  // Switching screens while it's open shows that screen's topic list.
  win.addEventListener("hashchange", () => {
    if (isOpen() && topicId === null) showList();
  });
  const openTopic = (id: string) => {
    if (!isOpen()) open();
    showTopic(id);
  };
  // Links can open a topic directly: options.html#help/danger.
  const fromHash = () => {
    const id = /^#help\/([\w-]+)$/.exec(win.location.hash)?.[1];
    if (id && TOPICS.some((topic) => topic.id === id)) openTopic(id);
  };
  win.addEventListener("hashchange", fromHash);
  fromHash();
  return { open, close, isOpen, openTopic };
}

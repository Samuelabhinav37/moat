// Wires the "How it works" scenes (explainers.ts) into the Settings page.
// Every row that has a scene gets a "How it works" button. Wide screens
// (>= 1280px, see options.html) have a side panel: it starts beside the
// screen's first section, and the button moves it level with its row and
// highlights that row, so the picture is always next to what it explains.
// Narrower screens have no panel: the button opens the picture inline.

import { SCREEN_SCENES, buildScene, hasScene } from "./explainers";

type Translate = (key: string, fallback: string) => string;

/** A row id that shares another row's picture. */
const SCENE_ALIASES: Record<string, string> = {
  firefoxResistFingerprinting: "fingerprint",
  firefoxFirstPartyIsolate: "cookies",
};

/** One or two plain sentences under each picture. */
export const CAPTIONS: Record<string, [string, string]> = {
  levels: ["explainLevels", "Each level adds more. Light stops ads and scams. Balanced also stops trackers. Strict also hides cookie notices and blocks third-party cookies."],
  consentReject: ["explainConsentReject", "When a site shows a cookie banner, Moat picks the choice that shares the least, so you never have to click it."],
  grayscale: ["explainGrayscale", "Some video ads come from the same server as the video, so blocking them would stop the video too. Moat fades them to gray while they play."],
  feedScan: ["explainFeedScan", "As you scroll, Moat looks for the Sponsored label on posts and takes those posts out of your feed."],
  leakedPassword: ["explainLeakedPassword", "Moat checks a short scrambled piece of a password you type against known breaches. Your password itself never leaves your computer."],
  cookies: ["explainCookies", "A tracker on one site leaves a cookie so it can spot you on the next one. Moat stops sites from sharing those cookies."],
  webrtc: ["explainWebrtc", "Video-call features can show a page your real IP address, even behind a VPN. Moat keeps it hidden."],
  fingerprint: ["explainFingerprint", "Sites can recognize you from details like your screen, fonts and graphics card. Moat changes those details slightly on every visit."],
  cname: ["explainCname", "Some trackers hide behind the site's own address. Moat looks up where that address really points and blocks it if it's a tracker."],
  searchSlop: ["explainSearchSlop", "Results from known content farms fold away behind a Show link, so they're still one click away."],
  permissionGuard: ["explainPermissionGuard", "Pages that ask for your camera, microphone or location as soon as they load are stopped. Allow a site from Moat's popup when you trust it."],
  lists: ["explainLists", "Filter lists are shared blocklists that their authors keep up to date. Moat combines the lists for your level into one set of rules."],
  paused: ["explainPaused", "On a paused site, ads and trackers load as usual. Known phishing and malware sites stay blocked."],
  hidden: ["explainHidden", "Point at anything on a page and click it. Moat hides it there every time you visit."],
  rules: ["explainRules", "Your own rules beat the filter lists. Always block a site, or never block one a list gets wrong."],
  backup: ["explainBackup", "A backup is a plain text file you can open and read. Sync keeps the same settings on your other computers."],
};

export interface SceneStep {
  /** Where in the loop the step starts, 0 to 1. Matches the scene's
   * keyframes in options.html. */
  at: number;
  key: string;
  text: string;
}

/** The words for each moment of a scene's animation, shown one at a time
 * under the picture while it plays. `ms` is the loop's length in
 * options.html. Scenes that loop without a story (fingerprint, lists,
 * backup) have none; their caption is enough. */
export const STEPS: Record<string, { ms: number; steps: SceneStep[] }> = {
  levels: {
    ms: 5000,
    steps: [
      { at: 0, key: "explainStepLevels1", text: "A page with an ad, trackers and a cookie notice" },
      { at: 0.16, key: "explainStepLevels2", text: "Light removes the ad" },
      { at: 0.41, key: "explainStepLevels3", text: "Balanced also stops the trackers" },
      { at: 0.66, key: "explainStepLevels4", text: "Strict also hides the cookie notice" },
    ],
  },
  consentReject: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepConsent1", text: "A cookie banner appears" },
      { at: 0.33, key: "explainStepConsent2", text: "Moat picks the choice that shares the least" },
      { at: 0.56, key: "explainStepConsent3", text: "The banner is gone" },
    ],
  },
  grayscale: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepGrayscale1", text: "An ad plays inside the video" },
      { at: 0.26, key: "explainStepGrayscale2", text: "Moat fades it to gray until it ends" },
    ],
  },
  feedScan: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepFeed1", text: "A sponsored post is in your feed" },
      { at: 0.32, key: "explainStepFeed2", text: "Moat takes it out" },
    ],
  },
  leakedPassword: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepPassword1", text: "You type a password" },
      { at: 0.44, key: "explainStepPassword2", text: "It was in a known breach, so Moat warns you" },
    ],
  },
  cookies: {
    ms: 4000,
    steps: [
      { at: 0, key: "explainStepCookies1", text: "A tracker's cookie tries to follow you" },
      { at: 0.42, key: "explainStepCookies2", text: "Moat stops it at the next site" },
    ],
  },
  webrtc: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepWebrtc1", text: "A call feature can read your real IP address" },
      { at: 0.36, key: "explainStepWebrtc2", text: "Moat hides it from the page" },
    ],
  },
  cname: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepCname1", text: "A tracker hides under the site's own address" },
      { at: 0.36, key: "explainStepCname2", text: "Moat looks up where it really points" },
      { at: 0.52, key: "explainStepCname3", text: "It's a tracker, so Moat blocks it" },
    ],
  },
  searchSlop: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepSlop1", text: "A content-farm result shows up" },
      { at: 0.34, key: "explainStepSlop2", text: "Moat folds it behind a Show link" },
    ],
  },
  permissionGuard: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepPermission1", text: "A page asks for your camera as it loads" },
      { at: 0.42, key: "explainStepPermission2", text: "Moat stops the request" },
    ],
  },
  paused: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepPaused1", text: "You pause a site you trust" },
      { at: 0.3, key: "explainStepPaused2", text: "Its ads load again" },
      { at: 0.5, key: "explainStepPaused3", text: "Dangerous sites stay blocked" },
    ],
  },
  hidden: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepHidden1", text: "Point at something on the page" },
      { at: 0.38, key: "explainStepHidden2", text: "Click it" },
      { at: 0.46, key: "explainStepHidden3", text: "It's gone, on every visit" },
    ],
  },
  rules: {
    ms: 4500,
    steps: [
      { at: 0, key: "explainStepRules1", text: "Your own rules are checked first" },
      { at: 0.52, key: "explainStepRules2", text: "One site is always blocked, the other never is" },
    ],
  },
};

export function sceneFor(rowId: string): string | null {
  const id = SCENE_ALIASES[rowId] ?? rowId;
  return hasScene(id) ? id : null;
}

function caption(id: string, t: Translate): string {
  const entry = CAPTIONS[id];
  return entry ? t(entry[0], entry[1]) : "";
}

/** Which step a point in the loop (0 to 1) falls in. */
export function stepAt(steps: SceneStep[], progress: number): number {
  let index = 0;
  steps.forEach((step, i) => {
    if (progress >= step.at) index = i;
  });
  return index;
}

function renderStep(line: HTMLElement, steps: SceneStep[], index: number, t: Translate): void {
  const step = steps[index]!;
  const number = document.createElement("b");
  number.textContent = String(index + 1);
  line.replaceChildren(number, t(step.key, step.text));
}

/** The line under a picture that says what's happening in it. It follows
 * the scene's own animation clock, so the words change with the picture.
 * Without animation (reduced motion, or a browser without getAnimations)
 * it lists every step at once. Returns null for scenes with no steps. */
export function buildStepLine(sceneId: string, scene: SVGElement, t: Translate): HTMLElement | null {
  const entry = STEPS[sceneId];
  if (!entry) return null;
  const line = document.createElement("p");
  line.className = "ex-step-line";
  line.setAttribute("aria-live", "off");

  const clock = () =>
    scene
      .getAnimations?.({ subtree: true })
      .find((animation) => Number(animation.effect?.getTiming().duration) === entry.ms);

  const ALL = -1;
  let shown = 0;
  let attached = false;
  const tick = () => {
    if (!line.isConnected) {
      // Stop once the picture has been replaced or removed.
      if (attached) clearInterval(timer);
      return;
    }
    attached = true;
    const time = Number(clock()?.currentTime ?? NaN);
    if (Number.isNaN(time)) {
      // No clock to follow: tell the whole story at once.
      if (shown !== ALL) {
        shown = ALL;
        line.replaceChildren(
          ...entry.steps.map((step, i) => {
            const part = document.createElement("span");
            part.className = "ex-step-all";
            const number = document.createElement("b");
            number.textContent = String(i + 1);
            part.append(number, t(step.key, step.text));
            return part;
          })
        );
      }
      return;
    }
    const index = stepAt(entry.steps, (time % entry.ms) / entry.ms);
    if (index !== shown) {
      shown = index;
      renderStep(line, entry.steps, index, t);
    }
  };
  renderStep(line, entry.steps, 0, t);
  const timer = setInterval(tick, 150);
  return line;
}

function fillPicture(target: HTMLElement, sceneId: string, t: Translate, captionEl?: HTMLElement): void {
  const scene = buildScene(sceneId);
  const step = buildStepLine(sceneId, scene, t);
  if (captionEl) {
    target.replaceChildren(scene, ...(step ? [step] : []));
    captionEl.textContent = caption(sceneId, t);
    return;
  }
  const text = document.createElement("p");
  text.textContent = caption(sceneId, t);
  target.replaceChildren(scene, ...(step ? [step] : []), text);
}

/** The "How it works" button under a row's text, and the inline picture it
 * opens on narrow screens. On wide screens the side panel handles the
 * click instead (see initExplainerPanel), and the inline body stays hidden
 * by CSS. */
export function buildInlineExplainer(sceneId: string, t: Translate): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ex-inline";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ex-howto";
  button.textContent = t("explainHowItWorks", "How it works");
  button.setAttribute("aria-expanded", "false");
  const body = document.createElement("div");
  body.className = "ex-inline-body";
  body.hidden = true;
  button.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const open = body.hidden;
    if (open) {
      // One open at a time.
      for (const other of document.querySelectorAll<HTMLElement>(".ex-inline-body:not([hidden])")) {
        other.hidden = true;
        other.previousElementSibling?.setAttribute("aria-expanded", "false");
      }
      if (!body.firstChild) fillPicture(body, sceneId, t);
    }
    body.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  wrap.append(button, body);
  return wrap;
}

/** The name shown above a picture: the row's own title, the label its
 * group points at (the level cards), or else the screen's title. */
function titleOf(doc: Document, target: HTMLElement | null): string {
  const own = target?.querySelector(".setting-title")?.textContent;
  if (own) return own;
  const labelledBy = target?.getAttribute("aria-labelledby");
  const label = labelledBy ? doc.getElementById(labelledBy)?.textContent : null;
  return label || (doc.getElementById("page-title")?.textContent ?? "");
}

/** Fills the side panel for the current screen. A row's "How it works"
 * button, where the panel is showing, moves the panel level with that row
 * and highlights it; pressing it again (or Esc) puts the panel back beside
 * the screen's first section. `refresh` re-picks the first picture once
 * the screen's rows exist (they render after the screen is chosen). */
export function initExplainerPanel(doc: Document, t: Translate): { showScreen: (page: string) => void; refresh: () => void } {
  const panel = doc.getElementById("explainer");
  const titleEl = doc.getElementById("explainer-title");
  const stage = doc.getElementById("explainer-stage");
  const captionEl = doc.getElementById("explainer-caption");
  let current = "";
  let page = "";
  let anchoredRow: HTMLElement | null = null;

  const show = (id: string, title: string) => {
    if (!panel || !stage || !titleEl || !captionEl) return;
    if (titleEl.textContent !== title) titleEl.textContent = title;
    if (id === current) return;
    current = id;
    fillPicture(stage, id, t, captionEl);
  };

  /** Lines the panel's top up with the row's, less the pointer's offset. */
  const place = () => {
    if (!panel) return;
    if (anchoredRow && !anchoredRow.isConnected) reattach();
    if (!anchoredRow) {
      panel.style.marginTop = "";
      return;
    }
    const base = panel.getBoundingClientRect().top - (parseFloat(getComputedStyle(panel).marginTop) || 0);
    panel.style.marginTop = `${Math.max(0, anchoredRow.getBoundingClientRect().top - base - 8)}px`;
  };

  /** Settings re-render their rows after a change (flipping the switch on
   * the row being explained, say), so find the new copy of the row. */
  const reattach = () => {
    const id = anchoredRow?.dataset.explain;
    const again = Array.from(doc.querySelectorAll<HTMLElement>(`main [data-explain="${id}"]`)).find((el) => !el.closest(".dash-off"));
    anchoredRow = again ?? null;
    if (!anchoredRow) {
      panel?.classList.remove("anchored");
      return;
    }
    anchoredRow.classList.add("is-explaining");
    anchoredRow.querySelector(".ex-howto")?.setAttribute("aria-expanded", "true");
  };

  const release = () => {
    if (anchoredRow) {
      anchoredRow.classList.remove("is-explaining");
      anchoredRow.querySelector(".ex-howto")?.setAttribute("aria-expanded", "false");
    }
    anchoredRow = null;
    panel?.classList.remove("anchored");
    place();
  };

  const showDefault = () => {
    const fallback = SCREEN_SCENES[page];
    if (panel) panel.hidden = !fallback;
    doc.body.classList.toggle("has-explainer", Boolean(fallback));
    if (!fallback) return;
    const first = Array.from(doc.querySelectorAll<HTMLElement>("main [data-explain]")).find((el) => !el.closest(".dash-off"));
    if (first) show(first.dataset.explain!, titleOf(doc, first));
    else show(fallback, titleOf(doc, null));
  };

  const showScreen = (next: string) => {
    page = next;
    release();
    showDefault();
  };

  const panelShowing = () => Boolean(panel && !panel.hidden && panel.offsetParent !== null);

  doc.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>(".ex-howto") : null;
    const row = button?.closest<HTMLElement>("[data-explain]");
    if (!button || !row || row.closest(".dash-off") || !panelShowing()) return;
    // The panel shows it; the inline picture stays closed.
    event.preventDefault();
    if (row === anchoredRow) {
      release();
      showDefault();
      return;
    }
    release();
    anchoredRow = row;
    row.classList.add("is-explaining");
    button.setAttribute("aria-expanded", "true");
    panel!.classList.add("anchored");
    show(row.dataset.explain!, titleOf(doc, row));
    place();
  }, true);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && anchoredRow) {
      const button = anchoredRow.querySelector<HTMLElement>(".ex-howto");
      release();
      showDefault();
      button?.focus();
    }
  });
  // Rows above can change height (a caution line appears, a list grows),
  // so keep the panel level with its row.
  const main = doc.querySelector("main");
  if (main && typeof ResizeObserver !== "undefined") new ResizeObserver(() => place()).observe(main);

  return { showScreen, refresh: () => (anchoredRow ? place() : showDefault()) };
}

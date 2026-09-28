// Wires the "How it works" scenes (explainers.ts) into the Settings page.
// A small info button sits after the title of each setting that has a
// picture, and after the screen's title for the screen's own picture.
// From 900px it opens a drawer at the right edge of the window, closed by
// default so no room is kept for it (at 1280px and up the page makes room
// for it while it's open). On phones it opens the picture inside the row.

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

/** Rows whose description already says enough: no info button. */
const ROWS_WITHOUT_HELP = new Set(["consentReject", "feedScan", "searchSlop"]);

/** The scene a setting row's info button shows, or null for no button. */
export function helpSceneFor(rowId: string): string | null {
  return ROWS_WITHOUT_HELP.has(rowId) ? null : sceneFor(rowId);
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

const SVG_NS = "http://www.w3.org/2000/svg";

/** The round "i" button. `title` is the setting (or screen) it explains,
 * so a screen reader hears "Dim YouTube ads: How it works". */
export function buildInfoButton(title: string, t: Translate): HTMLButtonElement {
  const label = t("explainHowItWorks", "How it works");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ex-info";
  button.title = label;
  button.setAttribute("aria-label", `${title}: ${label}`);
  button.setAttribute("aria-expanded", "false");
  button.append(infoIcon());
  return button;
}

/** The "i" in a ring, drawn with the button's text colour. */
export function infoIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const ring = document.createElementNS(SVG_NS, "circle");
  for (const [k, v] of Object.entries({ cx: "10", cy: "10", r: "7.6" })) ring.setAttribute(k, v);
  const stem = document.createElementNS(SVG_NS, "path");
  stem.setAttribute("d", "M10 9v4.6");
  const dot = document.createElementNS(SVG_NS, "circle");
  for (const [k, v] of Object.entries({ cx: "10", cy: "6.4", r: "0.9", class: "ex-info-dot" })) dot.setAttribute(k, v);
  svg.append(ring, stem, dot);
  return svg;
}

/** A row's info button and the inline picture it opens on phones. The
 * button goes after the row's title, the body under the row's text. On
 * wider screens the drawer takes the click (see initExplainerPanel) and
 * the body stays hidden by CSS. */
export function buildExplainer(sceneId: string, title: string, t: Translate): { button: HTMLButtonElement; body: HTMLElement } {
  const button = buildInfoButton(title, t);
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
        other.closest("[data-explain]")?.querySelector(".ex-info")?.setAttribute("aria-expanded", "false");
      }
      if (!body.firstChild) fillPicture(body, sceneId, t);
    }
    body.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  return { button, body };
}

/** The name shown above a picture: the row's own title, or else the
 * screen's title. */
function titleOf(doc: Document, row: HTMLElement | null): string {
  const own = row?.querySelector(".setting-title")?.textContent;
  return own || (doc.getElementById("page-title")?.textContent ?? "");
}

/** Runs the drawer. `showScreen` closes it and shows or hides the info
 * button next to the screen's title; `refresh` keeps an open drawer on its
 * row after the settings re-render their rows. */
export function initExplainerPanel(doc: Document, t: Translate): { showScreen: (page: string) => void; refresh: () => void } {
  const drawer = doc.getElementById("explainer");
  const titleEl = doc.getElementById("explainer-title");
  const stage = doc.getElementById("explainer-stage");
  const captionEl = doc.getElementById("explainer-caption");
  const pageInfo = doc.getElementById("page-info");
  let page = "";
  let openScene = "";
  let openRow: HTMLElement | null = null;
  let opener: HTMLElement | null = null;

  // A drawer from 900px (the desktop layout); phones use the inline picture.
  const drawerLayout = () => doc.defaultView?.matchMedia?.("(min-width: 900px)").matches ?? true;

  const mark = (on: boolean) => {
    openRow?.classList.toggle("is-explaining", on);
    opener?.setAttribute("aria-expanded", String(on));
  };

  const close = (returnFocus = false) => {
    if (!drawer || drawer.hidden) return;
    mark(false);
    drawer.hidden = true;
    doc.body.classList.remove("ex-open");
    if (returnFocus) opener?.focus();
    openRow = null;
    opener = null;
    openScene = "";
  };

  const open = (sceneId: string, title: string, row: HTMLElement | null, button: HTMLElement) => {
    if (!drawer || !stage || !titleEl || !captionEl) return;
    mark(false);
    openRow = row;
    opener = button;
    mark(true);
    titleEl.textContent = title;
    if (sceneId !== openScene) fillPicture(stage, sceneId, t, captionEl);
    openScene = sceneId;
    drawer.hidden = false;
    doc.body.classList.add("ex-open");
  };

  const showScreen = (next: string) => {
    page = next;
    close();
    if (pageInfo) {
      pageInfo.hidden = !SCREEN_SCENES[page];
      const label = t("explainHowItWorks", "How it works");
      pageInfo.title = label;
      pageInfo.setAttribute("aria-label", `${doc.getElementById("page-title")?.textContent ?? ""}: ${label}`);
    }
  };

  pageInfo?.addEventListener("click", () => {
    const scene = SCREEN_SCENES[page];
    if (!scene) return;
    if (opener === pageInfo && drawer && !drawer.hidden) close();
    else open(scene, titleOf(doc, null), null, pageInfo);
  });

  // Capture phase, so on wide screens the drawer claims the click before
  // the row's own inline handler runs.
  doc.addEventListener(
    "click",
    (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>(".ex-info") : null;
      const row = button?.closest<HTMLElement>("[data-explain]");
      if (!button || !row || row.closest(".dash-off") || !drawerLayout()) return;
      event.preventDefault();
      if (button === opener && drawer && !drawer.hidden) close();
      else open(row.dataset.explain!, titleOf(doc, row), row, button);
    },
    true
  );
  doc.getElementById("explainer-close")?.addEventListener("click", () => close(true));
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer && !drawer.hidden) close(true);
  });

  /** Settings re-render their rows after a change (flipping the switch on
   * the row being explained, say), so find the new copy of the row. */
  const refresh = () => {
    if (!openRow || openRow.isConnected) return;
    const id = openRow.dataset.explain;
    const again = Array.from(doc.querySelectorAll<HTMLElement>(`main [data-explain="${id}"]`)).find((el) => !el.closest(".dash-off"));
    if (!again) {
      close();
      return;
    }
    openRow = again;
    opener = again.querySelector<HTMLElement>(".ex-info");
    mark(true);
  };

  return { showScreen, refresh };
}

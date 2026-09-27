// Wires the "How it works" scenes (explainers.ts) into the Settings page.
// Wide screens (>= 1280px, see options.html) have a side panel that shows
// the current screen's scene, then follows whichever setting row is
// hovered or focused. Narrower screens have no panel: each row that has a
// scene gets a small "How it works" button that opens it inline.

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

export function sceneFor(rowId: string): string | null {
  const id = SCENE_ALIASES[rowId] ?? rowId;
  return hasScene(id) ? id : null;
}

function caption(id: string, t: Translate): string {
  const entry = CAPTIONS[id];
  return entry ? t(entry[0], entry[1]) : "";
}

/** The inline "How it works" button and picture a narrow screen shows under
 * a row's text. The button is hidden by CSS where the side panel exists. */
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
  button.addEventListener("click", () => {
    const open = body.hidden;
    if (open && !body.firstChild) {
      const text = document.createElement("p");
      text.textContent = caption(sceneId, t);
      body.append(buildScene(sceneId), text);
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

/** Fills the side panel for the current screen and keeps it in step with
 * the row under the pointer or keyboard focus. `refresh` re-picks the
 * screen's first picture once its rows exist (they render after the
 * screen is chosen), unless the reader already pointed at one. */
export function initExplainerPanel(doc: Document, t: Translate): { showScreen: (page: string) => void; refresh: () => void } {
  const panel = doc.getElementById("explainer");
  const titleEl = doc.getElementById("explainer-title");
  const stage = doc.getElementById("explainer-stage");
  const captionEl = doc.getElementById("explainer-caption");
  let current = "";
  let page = "";
  let followed = false;

  const show = (id: string, title: string) => {
    if (!panel || !stage || !titleEl || !captionEl) return;
    if (titleEl.textContent !== title) titleEl.textContent = title;
    if (id === current) return;
    current = id;
    stage.replaceChildren(buildScene(id));
    captionEl.textContent = caption(id, t);
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
    followed = false;
    showDefault();
  };

  const follow = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-explain]") : null;
    if (!target || target.closest(".dash-off")) return;
    followed = true;
    show(target.dataset.explain!, titleOf(doc, target));
  };
  doc.addEventListener("pointerover", follow);
  doc.addEventListener("focusin", follow);
  return { showScreen, refresh: () => followed || showDefault() };
}

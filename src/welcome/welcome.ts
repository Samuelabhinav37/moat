// First-run tour: four steps shown once, in a tab background/firstRunTour.ts
// opens on a fresh install. Nothing here changes protection; Moat is already
// blocking before this page loads. The before/after screenshots and numbers
// are real captures (docs/research/first-run-tour-2026-09.md).
import browser from "webextension-polyfill";
import { applyStaticI18n, getMessageOrFallback } from "../shared/i18n";
import { dismissOnboarding } from "../background/updateNotice";
import { watchPinState, type ActionLike, type PinState } from "./pinState";

const getMessage = (key: string, subs?: string | string[]) => browser.i18n.getMessage(key, subs);
const t = (key: string, fallback: string, subs?: string | string[]) => getMessageOrFallback(getMessage, key, fallback, subs);

applyStaticI18n(document, getMessage);
document.documentElement.lang = browser.i18n.getUILanguage();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STEPS = 4;

interface Site {
  name: string;
  url: string;
  tag: { left: string; top: string };
  before: string;
  after: string;
  beforeAlt: string;
  afterAlt: string;
  facts: [title: string, sub: string][];
  blocked: number;
}

const SITES: Record<"weather" | "forbes", Site> = {
  weather: {
    name: "weather.com",
    url: "https://weather.com/",
    tag: { left: "21%", top: "14%" },
    before: "welcome/img/weather.com-none.jpg",
    after: "welcome/img/weather.com-moat.jpg",
    beforeAlt: t("tourWeatherBeforeAlt", "weather.com without Moat: a large product ad fills the top of the page"),
    afterAlt: t("tourWeatherAfterAlt", "weather.com with Moat: the ad is gone and the story moves up"),
    facts: [
      [t("tourWeatherFact1", "The ad at the top is gone"), t("tourWeatherFact1Sub", "The story moves up into its place.")],
      [t("tourSeeFact2", "Stopped before it downloaded"), t("tourSeeFact2Sub", "The ad and the trackers behind it never loaded, so the page had less to fetch.")],
      [t("tourSeeFact3", "Nothing to set up"), t("tourSeeFact3Sub", "This happens on every site, on your device, from the moment Moat is installed.")],
    ],
    blocked: 27,
  },
  forbes: {
    name: "forbes.com",
    url: "https://www.forbes.com/",
    tag: { left: "17%", top: "24%" },
    before: "welcome/img/forbes.com-none.jpg",
    after: "welcome/img/forbes.com-moat.jpg",
    beforeAlt: t("tourForbesBeforeAlt", "forbes.com without Moat: a banner ad sits under the menu"),
    afterAlt: t("tourForbesAfterAlt", "forbes.com with Moat: the banner is gone"),
    facts: [
      [t("tourForbesFact1", "The banner under the menu is gone"), t("tourForbesFact1Sub", "The headlines move up.")],
      [t("tourSeeFact2", "Stopped before it downloaded"), t("tourSeeFact2Sub", "The ad and the trackers behind it never loaded, so the page had less to fetch.")],
      [t("tourSeeFact3", "Nothing to set up"), t("tourSeeFact3Sub", "This happens on every site, on your device, from the moment Moat is installed.")],
    ],
    blocked: 23,
  },
};

// Hosts from the real weather.com capture. Descriptions are ours.
const REQUESTS: [host: string, what: string, loaded: boolean][] = [
  ["weather.com", t("tourReqPage", "The page itself"), true],
  ["s.w-x.co", t("tourReqMaps", "Weather maps and photos"), true],
  ["securepubads.g.doubleclick.net", t("tourReqAdServer", "Google ad server"), false],
  ["micro.rubiconproject.com", t("tourReqAuction", "Ad auction"), false],
  ["api.lab.amplitude.com", t("tourReqAnalytics", "Behavior analytics"), false],
  ["mparticle.weather.com", t("tourReqFirstParty", "Tracker on weather.com's own domain"), false],
  ["js-agent.newrelic.com", t("tourReqMonitoring", "Session monitoring"), false],
  ["weather-channel.solutions.cdn.optable.co", t("tourReqAudience", "Audience data for advertisers"), false],
];

const isFirefox = typeof (browser.runtime as { getBrowserInfo?: unknown }).getBrowserInfo === "function";
// The native namespace, not the polyfill's wrapper: the polyfill doesn't
// know getUserSettings, and both browsers return promises natively.
const nativeAction = ((globalThis as { browser?: { action?: ActionLike } }).browser?.action ??
  (globalThis as { chrome?: { action?: ActionLike } }).chrome?.action) as ActionLike | undefined;

let step = 1;
let pinState: PinState = "unknown";
// "Already pinned" only if Moat was pinned before the user got here; once
// the browser has reported it unpinned, a later "pinned" is the user's doing.
let sawUnpinned = false;
let stopWatching: (() => void) | undefined;

function show(n: number): void {
  step = n;
  for (const el of document.querySelectorAll<HTMLElement>("[data-step]")) el.classList.toggle("active", el.dataset.step === String(n));
  document.querySelectorAll(".progress span").forEach((bar, i) => bar.classList.toggle("on", i < n));
  $("step-label").textContent = t("tourStepLabel", `Step ${n} of ${STEPS}`, [String(n), String(STEPS)]);
  $("back").hidden = n === 1;
  $("next").textContent =
    n === STEPS
      ? t("tourFinish", "Start browsing")
      : n === 3 && pinState === "unpinned"
        ? t("tourContinueUnpinned", "Continue without pinning")
        : t("tourContinue", "Continue");
  $("skip").textContent = n === STEPS ? t("tourOpenSettings", "Open Settings") : t("tourSkip", "Skip tour");
  if (n === 2) playFlow();
  if (n === 3 && !stopWatching) stopWatching = watchPinState(nativeAction, renderPin);
  if (n !== 3 && stopWatching) {
    stopWatching();
    stopWatching = undefined;
  }
}

async function finish(openSettings: boolean): Promise<void> {
  // The popup's one-line first-run card says what this tour already did.
  await dismissOnboarding();
  if (openSettings) await browser.runtime.openOptionsPage();
  const tab = await browser.tabs.getCurrent();
  if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
}

$("next").addEventListener("click", () => (step < STEPS ? show(step + 1) : void finish(false)));
$("back").addEventListener("click", () => show(step - 1));
$("skip").addEventListener("click", () => (step < STEPS ? show(STEPS) : void finish(true)));

// ---------- Step 1: real before/after ----------

let site: keyof typeof SITES = "weather";

function renderSite(): void {
  const s = SITES[site];
  $("see-lede").textContent = t(
    "tourSeeLede",
    `This is ${s.name}, loaded twice in Chrome: once on its own and once with Moat. Flip the switch to compare.`,
    s.name
  );
  $("url").textContent = s.url;
  const before = $<HTMLImageElement>("img-before");
  const after = $<HTMLImageElement>("img-after");
  before.src = s.before;
  before.alt = s.beforeAlt;
  after.src = s.after;
  after.alt = s.afterAlt;
  $("ad-tag").style.left = s.tag.left;
  $("ad-tag").style.top = s.tag.top;
  $("badge").textContent = String(s.blocked);

  $("facts").replaceChildren(
    ...s.facts.map(([title, sub]) => {
      const li = document.createElement("li");
      const body = document.createElement("div");
      body.append(document.createTextNode(title), el("span", "sub", sub));
      li.append(checkIcon(), body);
      return li;
    })
  );
  for (const tab of document.querySelectorAll<HTMLElement>(".tabs button")) {
    tab.setAttribute("aria-selected", String(tab.dataset.site === site));
  }
}

function setMoat(on: boolean): void {
  $("on").setAttribute("aria-pressed", String(on));
  $("off").setAttribute("aria-pressed", String(!on));
  $("shot").classList.toggle("moat", on);
  $("badge").hidden = !on;
}

$("on").addEventListener("click", () => setMoat(true));
$("off").addEventListener("click", () => setMoat(false));
for (const tab of document.querySelectorAll<HTMLElement>(".tabs button")) {
  tab.addEventListener("click", () => {
    site = tab.dataset.site as keyof typeof SITES;
    renderSite();
  });
}

// ---------- Step 2: request by request ----------

$("rows").replaceChildren(
  ...REQUESTS.map(([host, what, loaded]) => {
    const row = el("div", `req ${loaded ? "pass" : "stop"} done`);
    const hostCell = el("span", "host");
    hostCell.append(el("span", "h", host), el("span", "what", what));
    const gate = el("span", "gate");
    gate.append(el("span", "dot"));
    row.append(hostCell, gate, el("span", "out", loaded ? t("tourLoaded", "Loaded") : `✕ ${t("tourStopped", "Stopped")}`));
    return row;
  })
);

let flowTimers: ReturnType<typeof setTimeout>[] = [];
function playFlow(): void {
  flowTimers.forEach(clearTimeout);
  flowTimers = [];
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const rows = [...document.querySelectorAll<HTMLElement>(".req")];
  rows.forEach((row) => row.classList.remove("done"));
  rows.forEach((row, i) => flowTimers.push(setTimeout(() => row.classList.add("done"), 250 + i * 320)));
}
$("replay").addEventListener("click", playFlow);

// ---------- Step 3: pin ----------

$("how-2-text").textContent = isFirefox
  ? t("tourPinStep2Firefox", "Click the gear next to Moat, then Pin to Toolbar.")
  : t("tourPinStep2Chrome", "Click the pin next to Moat.");

const menu = isFirefox ? $("menu-firefox") : $("menu-chrome");

function renderPin(state: PinState): void {
  if (state === "unpinned") sawUnpinned = true;
  pinState = state;
  const status = $("status");
  status.hidden = state === "unknown";
  status.classList.toggle("pinned", state === "pinned");
  $("status-text").textContent =
    state === "pinned"
      ? sawUnpinned
        ? t("tourPinDone", "Pinned. Moat is next to your address bar.")
        : t("tourPinAlready", "Already pinned. You're all set.")
      : t("tourPinNotYet", "Moat isn't pinned yet");
  const done = state === "pinned";
  $("how-1").classList.toggle("done", done);
  $("how-2").classList.toggle("done", done);
  $("pinned-icon").classList.toggle("show", done);
  if (done) {
    menu.hidden = true;
    $("puzzle").classList.remove("pulse", "active");
  }
  if (step === 3) show(3);
}

$("puzzle").addEventListener("click", () => {
  menu.hidden = !menu.hidden;
  $("puzzle").classList.toggle("active", !menu.hidden);
  $("puzzle").classList.remove("pulse");
  $("puzzle").setAttribute("aria-expanded", String(!menu.hidden));
});
// Practice clicks in the illustration only change the illustration. The
// status box reports what the browser says, never these clicks.
function practicePin(): void {
  menu.hidden = true;
  $("pinned-icon").classList.add("show");
  $("pin-chrome").classList.add("pinned");
  $("puzzle").classList.remove("pulse", "active");
}
$("pin-chrome").addEventListener("click", practicePin);
$("gear-firefox").addEventListener("click", () => {
  $("ff-sub").hidden = !$("ff-sub").hidden;
  $("gear-firefox").classList.remove("pulse");
});
$("pin-firefox").addEventListener("click", practicePin);

// ---------- helpers ----------

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function checkIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m5 12 5 5 9-10");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2.4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

renderSite();
show(1);

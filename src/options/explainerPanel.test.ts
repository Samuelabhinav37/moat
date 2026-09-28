// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { SCREEN_SCENES, buildScene, hasScene } from "./explainers";
import { CAPTIONS, STEPS, buildExplainer, buildStepLine, helpSceneFor, initExplainerPanel, sceneFor, stepAt } from "./explainerPanel";

const t = (_key: string, fallback: string) => fallback;

// Every setting row id in options.ts that should have a picture.
const ROW_IDS = [
  "consentReject",
  "grayscale",
  "feedScan",
  "leakedPassword",
  "cookies",
  "webrtc",
  "fingerprint",
  "cname",
  "searchSlop",
  "permissionGuard",
  "firefoxResistFingerprinting",
  "firefoxFirstPartyIsolate",
];

function page(): void {
  document.body.innerHTML = `
    <main>
      <div class="page-head"><h1 id="page-title">Privacy</h1><button id="page-info" hidden></button></div>
      <aside id="explainer" hidden><button id="explainer-close"></button><h2 id="explainer-title"></h2><div id="explainer-stage"></div><p id="explainer-caption"></p></aside>
      <section data-page="blocking" class="dash-off"><div data-explain="levels" aria-labelledby="lvl"><span id="lvl" hidden>How much to block</span></div></section>
      <section data-page="privacy">
        <div class="setting-row" data-explain="cookies"><div><span class="setting-title">Block cross-site cookies</span></div></div>
        <div class="setting-row" data-explain="webrtc"><div><span class="setting-title">Keep your IP address private</span></div><button id="ip-switch"></button></div>
      </section>
    </main>`;
}

beforeEach(page);

describe("scenes", () => {
  it("gives every setting row a picture and a caption", () => {
    for (const id of ROW_IDS) {
      const scene = sceneFor(id);
      expect(scene, id).not.toBeNull();
      expect(CAPTIONS[scene!], id).toBeDefined();
    }
    expect(sceneFor("list")).toBeNull();
  });

  it("has a picture and caption for every screen default", () => {
    for (const id of Object.values(SCREEN_SCENES)) {
      expect(hasScene(id), id).toBe(true);
      expect(CAPTIONS[id], id).toBeDefined();
    }
  });

  it("builds every scene as a decorative SVG with no words to translate beyond hostnames", () => {
    for (const id of Object.keys(CAPTIONS)) {
      const svg = buildScene(id);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.querySelectorAll("*").length).toBeGreaterThan(3);
    }
  });

  it("has every caption key in each locale", () => {
    for (const locale of ["en", "es", "fr", "de"]) {
      const messages = JSON.parse(readFileSync(`src/_locales/${locale}/messages.json`, "utf8")) as Record<string, unknown>;
      for (const [key] of Object.values(CAPTIONS)) expect(messages[key], `${locale} ${key}`).toBeDefined();
    }
  });
});

describe("drawer", () => {
  const setWidth = (wide: boolean) => {
    window.matchMedia = ((query: string) => ({ matches: wide, media: query })) as unknown as typeof window.matchMedia;
  };
  beforeEach(() => {
    setWidth(true);
    for (const row of document.querySelectorAll<HTMLElement>("[data-explain].setting-row")) {
      const title = row.querySelector(".setting-title")!;
      const { button, body } = buildExplainer(row.dataset.explain!, title.textContent!, t);
      title.after(button);
      title.parentElement!.append(body);
    }
  });
  const info = (id: string) => document.querySelector<HTMLButtonElement>(`[data-explain="${id}"] .ex-info`)!;
  const drawer = () => document.getElementById("explainer")!;
  const title = () => document.getElementById("explainer-title")!.textContent;

  it("starts closed, with nothing kept for it", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    expect(drawer().hidden).toBe(true);
    expect(document.body.classList.contains("ex-open")).toBe(false);
    // The screen has its own picture, so its title gets an info button.
    expect(document.getElementById("page-info")!.hidden).toBe(false);
    expect(document.getElementById("page-info")!.getAttribute("aria-label")).toBe("Privacy: How it works");
  });

  it("opens from a row's info button, marks the row, and closes on a second press, Esc or the close button", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    const row = document.querySelector<HTMLElement>('[data-explain="webrtc"]')!;
    info("webrtc").click();
    expect(drawer().hidden).toBe(false);
    expect(document.body.classList.contains("ex-open")).toBe(true);
    expect(title()).toBe("Keep your IP address private");
    expect(document.getElementById("explainer-caption")!.textContent).toBe(CAPTIONS.webrtc![1]);
    expect(row.classList.contains("is-explaining")).toBe(true);
    expect(info("webrtc").getAttribute("aria-expanded")).toBe("true");
    // The drawer shows it, so the inline copy stays shut.
    expect(row.querySelector<HTMLElement>(".ex-inline-body")!.hidden).toBe(true);

    info("cookies").click();
    expect(title()).toBe("Block cross-site cookies");
    expect(row.classList.contains("is-explaining")).toBe(false);
    expect(info("webrtc").getAttribute("aria-expanded")).toBe("false");

    info("cookies").click();
    expect(drawer().hidden).toBe(true);

    info("webrtc").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(drawer().hidden).toBe(true);
    expect(document.activeElement).toBe(info("webrtc"));
    expect(row.classList.contains("is-explaining")).toBe(false);

    info("webrtc").click();
    document.getElementById("explainer-close")!.click();
    expect(drawer().hidden).toBe(true);
  });

  it("shows the screen's own picture from the title's info button", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    document.getElementById("page-info")!.click();
    expect(drawer().hidden).toBe(false);
    expect(title()).toBe("Privacy");
    expect(document.querySelector("#explainer-stage svg")!.classList.contains(`ex-${SCREEN_SCENES.privacy}`)).toBe(true);
  });

  it("stays on the row when the settings re-render it", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    info("webrtc").click();
    const old = document.querySelector<HTMLElement>('[data-explain="webrtc"]')!;
    const fresh = old.cloneNode(true) as HTMLElement;
    fresh.classList.remove("is-explaining");
    old.replaceWith(fresh);
    panel.refresh();
    expect(fresh.classList.contains("is-explaining")).toBe(true);
    expect(title()).toBe("Keep your IP address private");
  });

  it("closes when the screen changes, and has no title button where a screen has no picture", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    info("webrtc").click();
    panel.showScreen("overview");
    expect(drawer().hidden).toBe(true);
    expect(document.querySelector(".is-explaining")).toBeNull();
    expect(document.getElementById("page-info")!.hidden).toBe(true);
  });

  it("leaves phones to the picture inside the row", () => {
    setWidth(false);
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    info("webrtc").click();
    expect(drawer().hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-explain="webrtc"] .ex-inline-body')!.hidden).toBe(false);
  });

  it("skips rows whose description already says enough", () => {
    for (const quiet of ["consentReject", "feedScan", "searchSlop"]) expect(helpSceneFor(quiet), quiet).toBeNull();
    expect(helpSceneFor("grayscale")).toBe("grayscale");
    expect(helpSceneFor("firefoxFirstPartyIsolate")).toBe("cookies");
  });
});

describe("step lines", () => {
  it("has steps in order and every step key in each locale", () => {
    for (const [id, { steps }] of Object.entries(STEPS)) {
      expect(hasScene(id), id).toBe(true);
      expect(steps[0]!.at, id).toBe(0);
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.at, id).toBeGreaterThan(steps[i - 1]!.at);
    }
    for (const locale of ["en", "es", "fr", "de"]) {
      const messages = JSON.parse(readFileSync(`src/_locales/${locale}/messages.json`, "utf8")) as Record<string, unknown>;
      for (const { steps } of Object.values(STEPS)) for (const step of steps) expect(messages[step.key], `${locale} ${step.key}`).toBeDefined();
    }
  });

  it("picks the step for a point in the loop", () => {
    const steps = STEPS.consentReject!.steps;
    expect(stepAt(steps, 0)).toBe(0);
    expect(stepAt(steps, 0.4)).toBe(1);
    expect(stepAt(steps, 0.99)).toBe(2);
  });

  it("starts on step one, and tells the whole story where nothing animates", async () => {
    const scene = buildScene("consentReject");
    const line = buildStepLine("consentReject", scene, t)!;
    expect(line.textContent).toBe("1" + STEPS.consentReject!.steps[0]!.text);
    document.body.append(scene, line);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(line.querySelectorAll(".ex-step-all")).toHaveLength(3);
    expect(buildStepLine("fingerprint", buildScene("fingerprint"), t)).toBeNull();
  });
});

describe("inline explainer", () => {
  it("opens and closes the picture under the row, one at a time", () => {
    // Phone width, where the drawer (from any earlier test) leaves the click alone.
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
    const a = buildExplainer("cookies", "Block cross-site cookies", t);
    const b = buildExplainer("webrtc", "Keep your IP address private", t);
    for (const { button, body } of [a, b]) {
      const row = document.createElement("div");
      row.dataset.explain = "x";
      row.append(button, body);
      document.body.append(row);
    }
    expect(a.button.getAttribute("aria-label")).toBe("Block cross-site cookies: How it works");
    expect(a.body.hidden).toBe(true);
    a.button.click();
    expect(a.body.hidden).toBe(false);
    expect(a.button.getAttribute("aria-expanded")).toBe("true");
    expect(a.body.querySelector("svg")).not.toBeNull();
    expect(a.body.querySelector(".ex-step-line")).not.toBeNull();
    b.button.click();
    expect(a.body.hidden).toBe(true);
    expect(a.button.getAttribute("aria-expanded")).toBe("false");
    a.button.click();
    a.button.click();
    expect(a.body.hidden).toBe(true);
  });
});

// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { SCREEN_SCENES, buildScene, hasScene } from "./explainers";
import { CAPTIONS, STEPS, buildInlineExplainer, buildStepLine, initExplainerPanel, sceneFor, stepAt } from "./explainerPanel";

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
      <div class="page-head"><h1 id="page-title">Privacy</h1></div>
      <aside id="explainer" hidden><h2 id="explainer-title"></h2><div id="explainer-stage"></div><p id="explainer-caption"></p></aside>
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

describe("side panel", () => {
  // jsdom has no layout, so offsetParent is always null; the panel counts
  // as showing when it isn't hidden.
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.hidden ? null : document.body; } });
    for (const row of document.querySelectorAll<HTMLElement>("[data-explain].setting-row")) {
      row.firstElementChild!.append(buildInlineExplainer(row.dataset.explain!, t));
    }
  });
  const howTo = (id: string) => document.querySelector<HTMLButtonElement>(`[data-explain="${id}"] .ex-howto`)!;
  const title = () => document.getElementById("explainer-title")!.textContent;

  it("opens on the screen's first row and doesn't follow the pointer", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    expect(document.getElementById("explainer")!.hidden).toBe(false);
    expect(document.body.classList.contains("has-explainer")).toBe(true);
    expect(title()).toBe("Block cross-site cookies");
    expect(document.querySelector("#explainer-stage svg")!.classList.contains("ex-cookies")).toBe(true);

    document.getElementById("ip-switch")!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    document.getElementById("ip-switch")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(title()).toBe("Block cross-site cookies");
  });

  it("moves to a row when its How it works is pressed, and back on a second press or Esc", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    const row = document.querySelector<HTMLElement>('[data-explain="webrtc"]')!;
    howTo("webrtc").click();
    expect(title()).toBe("Keep your IP address private");
    expect(document.getElementById("explainer-caption")!.textContent).toBe(CAPTIONS.webrtc![1]);
    expect(row.classList.contains("is-explaining")).toBe(true);
    expect(howTo("webrtc").getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("explainer")!.classList.contains("anchored")).toBe(true);
    // The panel shows it, so the inline copy stays shut.
    expect(row.querySelector<HTMLElement>(".ex-inline-body")!.hidden).toBe(true);

    howTo("webrtc").click();
    expect(row.classList.contains("is-explaining")).toBe(false);
    expect(title()).toBe("Block cross-site cookies");

    howTo("webrtc").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(row.classList.contains("is-explaining")).toBe(false);
    expect(document.getElementById("explainer")!.classList.contains("anchored")).toBe(false);
  });

  it("stays on the row when the settings re-render it", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    howTo("webrtc").click();
    const old = document.querySelector<HTMLElement>('[data-explain="webrtc"]')!;
    const fresh = old.cloneNode(true) as HTMLElement;
    fresh.classList.remove("is-explaining");
    old.replaceWith(fresh);
    panel.refresh();
    expect(fresh.classList.contains("is-explaining")).toBe(true);
    expect(title()).toBe("Keep your IP address private");
  });

  it("hides itself where a screen has no picture", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    howTo("webrtc").click();
    panel.showScreen("overview");
    expect(document.getElementById("explainer")!.hidden).toBe(true);
    expect(document.body.classList.contains("has-explainer")).toBe(false);
    expect(document.querySelector(".is-explaining")).toBeNull();
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
    const wrap = buildInlineExplainer("cookies", t);
    const other = buildInlineExplainer("webrtc", t);
    document.body.append(wrap, other);
    const button = wrap.querySelector("button")!;
    const body = wrap.querySelector<HTMLElement>(".ex-inline-body")!;
    expect(body.hidden).toBe(true);
    button.click();
    expect(body.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(body.querySelector("svg")).not.toBeNull();
    expect(body.querySelector(".ex-step-line")).not.toBeNull();
    other.querySelector("button")!.click();
    expect(body.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click();
    button.click();
    expect(body.hidden).toBe(true);
  });
});

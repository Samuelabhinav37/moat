// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { SCREEN_SCENES, buildScene, hasScene } from "./explainers";
import { CAPTIONS, buildInlineExplainer, initExplainerPanel, sceneFor } from "./explainerPanel";

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
        <div class="setting-row" data-explain="cookies"><span class="setting-title">Block cross-site cookies</span></div>
        <div class="setting-row" data-explain="webrtc"><span class="setting-title">Keep your IP address private</span><button id="ip-switch"></button></div>
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
  it("opens on the screen's first row, then follows the pointer and focus", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    expect(document.getElementById("explainer")!.hidden).toBe(false);
    expect(document.body.classList.contains("has-explainer")).toBe(true);
    expect(document.getElementById("explainer-title")!.textContent).toBe("Block cross-site cookies");
    expect(document.querySelector("#explainer-stage svg")!.classList.contains("ex-cookies")).toBe(true);

    document.getElementById("ip-switch")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(document.getElementById("explainer-title")!.textContent).toBe("Keep your IP address private");
    expect(document.getElementById("explainer-caption")!.textContent).toBe(CAPTIONS.webrtc![1]);

    // A later re-render doesn't take the picture away from what was pointed at.
    panel.refresh();
    expect(document.getElementById("explainer-title")!.textContent).toBe("Keep your IP address private");
  });

  it("ignores rows on other screens and hides itself where a screen has no picture", () => {
    const panel = initExplainerPanel(document, t);
    panel.showScreen("privacy");
    document.querySelector('[data-explain="levels"]')!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(document.getElementById("explainer-title")!.textContent).toBe("Block cross-site cookies");

    panel.showScreen("overview");
    expect(document.getElementById("explainer")!.hidden).toBe(true);
    expect(document.body.classList.contains("has-explainer")).toBe(false);
  });
});

describe("inline explainer", () => {
  it("opens and closes the picture under the row", () => {
    const wrap = buildInlineExplainer("cookies", t);
    const button = wrap.querySelector("button")!;
    const body = wrap.querySelector<HTMLElement>(".ex-inline-body")!;
    expect(body.hidden).toBe(true);
    button.click();
    expect(body.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(body.querySelector("svg")).not.toBeNull();
    button.click();
    expect(body.hidden).toBe(true);
  });
});

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyStaticI18n, getMessageOrFallback } from "./i18n";

interface MessageEntry {
  message: string;
}

function loadEnglishMessages(): Record<string, MessageEntry> {
  const path = join(__dirname, "..", "_locales", "en", "messages.json");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, MessageEntry>;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("getMessageOrFallback", () => {
  it("returns the looked-up message when it resolves", () => {
    const getMessage = (key: string) => (key === "greeting" ? "Hello" : "");
    expect(getMessageOrFallback(getMessage, "greeting", "fallback text")).toBe("Hello");
  });

  it("falls back when the key doesn't resolve, rather than blanking the text", () => {
    const getMessage = () => "";
    expect(getMessageOrFallback(getMessage, "missingKey", "fallback text")).toBe("fallback text");
  });

  it("passes substitutions through to getMessage", () => {
    const getMessage = (key: string, subs?: string | string[]) => `${key}:${String(subs)}`;
    expect(getMessageOrFallback(getMessage, "withArgs", "fallback", ["a", "b"])).toBe("withArgs:a,b");
  });
});

describe("applyStaticI18n", () => {
  it("replaces text content for every [data-i18n] element", () => {
    document.body.innerHTML = `
      <div data-i18n="title">Old Title</div>
      <span data-i18n="subtitle">Old Subtitle</span>
    `;
    const getMessage = (key: string) => ({ title: "New Title", subtitle: "New Subtitle" })[key] ?? "";
    applyStaticI18n(document.body, getMessage);
    expect(document.querySelector('[data-i18n="title"]')?.textContent).toBe("New Title");
    expect(document.querySelector('[data-i18n="subtitle"]')?.textContent).toBe("New Subtitle");
  });

  it("falls back to the existing text for a missing key instead of blanking it", () => {
    document.body.innerHTML = `<div data-i18n="unknownKey">Kept as-is</div>`;
    applyStaticI18n(document.body, () => "");
    expect(document.querySelector('[data-i18n="unknownKey"]')?.textContent).toBe("Kept as-is");
  });

  it("ignores elements without a data-i18n attribute", () => {
    document.body.innerHTML = `<div>Untouched</div>`;
    applyStaticI18n(document.body, () => "Should not appear");
    expect(document.querySelector("div")?.textContent).toBe("Untouched");
  });

  it("sets the placeholder attribute for [data-i18n-placeholder] inputs", () => {
    document.body.innerHTML = `<input data-i18n-placeholder="hostnamePlaceholder" placeholder="example.com" />`;
    const getMessage = (key: string) => (key === "hostnamePlaceholder" ? "translated.example" : "");
    applyStaticI18n(document.body, getMessage);
    expect((document.querySelector("input") as HTMLInputElement).placeholder).toBe("translated.example");
  });

  it("falls back to the existing placeholder for a missing key", () => {
    document.body.innerHTML = `<input data-i18n-placeholder="missingKey" placeholder="example.com" />`;
    applyStaticI18n(document.body, () => "");
    expect((document.querySelector("input") as HTMLInputElement).placeholder).toBe("example.com");
  });

  it("sets the aria-label attribute for [data-i18n-aria-label] elements", () => {
    document.body.innerHTML = `<button data-i18n-aria-label="closeLabel" aria-label="Close"></button>`;
    const getMessage = (key: string) => (key === "closeLabel" ? "Schließen" : "");
    applyStaticI18n(document.body, getMessage);
    expect(document.querySelector("button")?.getAttribute("aria-label")).toBe("Schließen");
  });

  it("falls back to the existing aria-label for a missing key", () => {
    document.body.innerHTML = `<button data-i18n-aria-label="missingKey" aria-label="Close"></button>`;
    applyStaticI18n(document.body, () => "");
    expect(document.querySelector("button")?.getAttribute("aria-label")).toBe("Close");
  });
});

// Regression test for a real bug: a `[data-i18n]` element that also has
// child elements gets those children silently destroyed the instant
// applyStaticI18n() sets its textContent -- exactly what happened to the
// rail-item buttons in options.html, each of which nested a badge/count
// <span> (id="rail-dot-protection" etc.) inside a data-i18n-tagged <button>.
// The badge span vanished on page load, so every later render() call that
// tried to set its `.hidden`/`.textContent` threw "Cannot set properties of
// null", aborting render() entirely -- the whole Options page stayed
// unpopulated ("everything is dormant"). Fixed by moving data-i18n onto a
// dedicated inner <span> that has no children of its own. This test reads
// the real built page sources (not synthetic HTML) so a future data-i18n
// addition that repeats the mistake fails here instead of silently bricking
// a page.
describe("data-i18n contract: no [data-i18n] element may have child elements", () => {
  const pages = [
    "options/options.html",
    "popup/popup.html",
    "warning/warning.html",
    "logger/logger.html",
  ];

  it.each(pages)("%s", (relativePath) => {
    const html = readFileSync(join(__dirname, "..", relativePath), "utf8");
    document.body.innerHTML = html;
    const offenders = [...document.querySelectorAll("[data-i18n]")].filter((el) => el.children.length > 0);
    expect(offenders.map((el) => el.outerHTML.split(">")[0] + ">")).toEqual([]);
  });
});

// Regression test for a real bug: an English fallback baked into the markup
// (applyStaticI18n's own doc comment calls this "the English copy left in
// the HTML as a dev-readability aid") is only ever SHOWN when the key is
// missing from messages.json entirely -- if the key already exists with
// different, stale wording, that stored message silently wins over the
// fallback at runtime with no error anywhere. This bit a real redesign pass:
// several `data-i18n` attributes were reused from an older section of the
// page with new fallback text, but the old English message was still
// sitting in messages.json, so production would have shown the STALE text
// -- in one case, directly undoing a page-title rename. The render-test
// mocks can't catch this class of bug at all (mockExtensionBrowser.ts's
// i18n.getMessage always returns "", which forces every test onto the
// fallback path) -- this reads the real messages.json and the real page
// sources instead, so a future `data-i18n` reuse that repeats the mistake
// fails here.
describe("data-i18n contract: HTML fallback text must match en/messages.json when the key already exists", () => {
  const pages = ["options/options.html", "popup/popup.html", "warning/warning.html", "logger/logger.html"];
  const englishMessages = loadEnglishMessages();

  it.each(pages)("%s", (relativePath) => {
    const html = readFileSync(join(__dirname, "..", relativePath), "utf8");
    document.body.innerHTML = html;
    const mismatches: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const key = el.dataset.i18n;
      if (!key) continue;
      const stored = englishMessages[key];
      if (!stored) continue; // A genuinely new key with no messages.json entry yet -- fallback is all there is, nothing to drift from.
      const fallback = normalizeWhitespace(el.textContent ?? "");
      const message = normalizeWhitespace(stored.message);
      if (fallback !== message) {
        mismatches.push(`${key}\n    html:  ${fallback}\n    stored: ${message}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

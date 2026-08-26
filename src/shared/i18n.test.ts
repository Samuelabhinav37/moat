// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyStaticI18n, getMessageOrFallback } from "./i18n";

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
});

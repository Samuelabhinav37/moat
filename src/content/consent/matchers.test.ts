// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { matches } from "./matchers";
import { newContext } from "./tools";
import type { CheckboxMatcherConfig, CssMatcherConfig, OnOffMatcherConfig, UrlMatcherConfig } from "./types";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("css matcher", () => {
  it("matches when the selector finds something", () => {
    document.body.innerHTML = '<div class="cmp"></div>';
    const config: CssMatcherConfig = { type: "css", target: { selector: ".cmp" } };
    expect(matches(config, newContext(document.body))).toBe(true);
  });

  it("does not match when the selector finds nothing", () => {
    document.body.innerHTML = "<div></div>";
    const config: CssMatcherConfig = { type: "css", target: { selector: ".cmp" } };
    expect(matches(config, newContext(document.body))).toBe(false);
  });
});

describe("checkbox matcher", () => {
  it("returns the checkbox's checked state", () => {
    document.body.innerHTML = '<input type="checkbox" class="c" checked />';
    const config: CheckboxMatcherConfig = { type: "checkbox", target: { selector: ".c" } };
    expect(matches(config, newContext(document.body))).toBe(true);
  });

  it("negated inverts the checked state", () => {
    document.body.innerHTML = '<input type="checkbox" class="c" checked />';
    const config: CheckboxMatcherConfig = { type: "checkbox", target: { selector: ".c" }, negated: true };
    expect(matches(config, newContext(document.body))).toBe(false);
  });

  it("fails safe (false) rather than throwing when no checkbox is found", () => {
    document.body.innerHTML = "<div></div>";
    const config: CheckboxMatcherConfig = { type: "checkbox", target: { selector: ".missing" } };
    expect(() => matches(config, newContext(document.body))).not.toThrow();
    expect(matches(config, newContext(document.body))).toBe(false);
  });

  it("fails safe (false) when the target isn't actually an input", () => {
    document.body.innerHTML = '<div class="c"></div>';
    const config: CheckboxMatcherConfig = { type: "checkbox", target: { selector: ".c" } };
    expect(matches(config, newContext(document.body))).toBe(false);
  });
});

describe("onoff matcher", () => {
  it("is true when only the on-target is present", () => {
    document.body.innerHTML = '<div class="on"></div>';
    const config: OnOffMatcherConfig = { type: "onoff", onMatcher: { selector: ".on" }, offMatcher: { selector: ".off" } };
    expect(matches(config, newContext(document.body))).toBe(true);
  });

  it("is false when only the off-target is present", () => {
    document.body.innerHTML = '<div class="off"></div>';
    const config: OnOffMatcherConfig = { type: "onoff", onMatcher: { selector: ".on" }, offMatcher: { selector: ".off" } };
    expect(matches(config, newContext(document.body))).toBe(false);
  });

  it("fails safe (false) rather than throwing when neither is found", () => {
    document.body.innerHTML = "<div></div>";
    const config: OnOffMatcherConfig = { type: "onoff", onMatcher: { selector: ".on" }, offMatcher: { selector: ".off" } };
    expect(() => matches(config, newContext(document.body))).not.toThrow();
    expect(matches(config, newContext(document.body))).toBe(false);
  });

  it("fails safe (false) rather than throwing when both are found", () => {
    document.body.innerHTML = '<div class="on"></div><div class="off"></div>';
    const config: OnOffMatcherConfig = { type: "onoff", onMatcher: { selector: ".on" }, offMatcher: { selector: ".off" } };
    expect(matches(config, newContext(document.body))).toBe(false);
  });
});

describe("url matcher", () => {
  const ctx = newContext(document.body);

  it("matches a plain substring", () => {
    const config: UrlMatcherConfig = { type: "url", url: "example.com" };
    expect(matches(config, ctx, "https://example.com/page")).toBe(true);
  });

  it("does not match when the substring is absent", () => {
    const config: UrlMatcherConfig = { type: "url", url: "other.com" };
    expect(matches(config, ctx, "https://example.com/page")).toBe(false);
  });

  it("matches any of an array of substrings", () => {
    const config: UrlMatcherConfig = { type: "url", url: ["other.com", "example.com"] };
    expect(matches(config, ctx, "https://example.com/page")).toBe(true);
  });

  it("supports regexp matching", () => {
    const config: UrlMatcherConfig = { type: "url", url: "^https://example\\.com/", regexp: true };
    expect(matches(config, ctx, "https://example.com/page")).toBe(true);
    expect(matches(config, ctx, "https://notexample.com/page")).toBe(false);
  });

  it("negated inverts the result", () => {
    const config: UrlMatcherConfig = { type: "url", url: "example.com", negated: true };
    expect(matches(config, ctx, "https://example.com/page")).toBe(false);
  });
});

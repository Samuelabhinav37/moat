import { beforeEach, describe, expect, it } from "vitest";
import { forgetTab, getLastNormalTabId, isNormalPageUrl, noteTabUrl, pickBestNormalTab } from "./lastNormalTab";

// Module-level state: reset it to a known point before each test by pointing
// it at a throwaway tab and then forgetting that tab.
beforeEach(() => {
  noteTabUrl(999, "https://reset.example");
  forgetTab(999);
});

describe("lastNormalTab", () => {
  it("remembers the most recent http/https tab", () => {
    noteTabUrl(1, "http://a.example/");
    expect(getLastNormalTabId()).toBe(1);
    noteTabUrl(2, "https://b.example/page");
    expect(getLastNormalTabId()).toBe(2);
  });

  it("ignores extension, chrome://, and about: pages", () => {
    noteTabUrl(1, "https://real.example/");
    noteTabUrl(2, "chrome-extension://abc/options.html");
    noteTabUrl(3, "about:blank");
    noteTabUrl(4, "chrome://extensions");
    expect(getLastNormalTabId()).toBe(1);
  });

  it("ignores an undefined or unparseable URL", () => {
    noteTabUrl(1, "https://real.example/");
    noteTabUrl(2, undefined);
    noteTabUrl(3, "not a url");
    expect(getLastNormalTabId()).toBe(1);
  });

  it("forgetTab clears only a matching id", () => {
    noteTabUrl(7, "https://seven.example/");
    forgetTab(8);
    expect(getLastNormalTabId()).toBe(7);
    forgetTab(7);
    expect(getLastNormalTabId()).toBeNull();
  });
});

describe("isNormalPageUrl", () => {
  it("accepts http and https", () => {
    expect(isNormalPageUrl("http://example.com/")).toBe(true);
    expect(isNormalPageUrl("https://example.com/page")).toBe(true);
  });

  it("rejects extension pages, chrome://, about:, undefined, and unparseable strings", () => {
    expect(isNormalPageUrl("chrome-extension://abc/options.html")).toBe(false);
    expect(isNormalPageUrl("chrome://extensions")).toBe(false);
    expect(isNormalPageUrl("about:blank")).toBe(false);
    expect(isNormalPageUrl(undefined)).toBe(false);
    expect(isNormalPageUrl("not a url")).toBe(false);
  });
});

describe("pickBestNormalTab", () => {
  // Regression test for a real bug: the Settings page opens in its own tab,
  // so if the service worker's in-memory lastNormalTabId happened to reset
  // (MV3 kills an idle worker routinely) while Settings was the focused tab,
  // the startup reseed in index.ts sees only the Settings tab itself -- an
  // extension page, which noteTabUrl always ignores -- and the pointer was
  // stuck null forever, silently breaking "Pick an element" and the
  // Trackers/Filter Lists tabs' per-tab breakdowns. index.ts's
  // resolveNormalTabId() falls back to a live browser.tabs.query({active:
  // true}) (one tab per window) and hands it to this function to pick from.
  it("returns null when every candidate is the extension's own page (the exact bug scenario)", () => {
    expect(pickBestNormalTab([{ id: 1, url: "chrome-extension://abc/options.html" }])).toBeNull();
  });

  it("picks the one normal page among the active tabs of every window", () => {
    const tabs = [
      { id: 1, url: "chrome-extension://abc/options.html" },
      { id: 2, url: "https://example.com/" },
    ];
    expect(pickBestNormalTab(tabs)).toBe(2);
  });

  it("prefers the most recently accessed normal tab when there are several", () => {
    const tabs = [
      { id: 1, url: "https://old.example/", lastAccessed: 100 },
      { id: 2, url: "https://new.example/", lastAccessed: 500 },
    ];
    expect(pickBestNormalTab(tabs)).toBe(2);
  });

  it("still returns a normal tab when lastAccessed is missing on all of them", () => {
    const tabs = [{ id: 1, url: "https://example.com/" }];
    expect(pickBestNormalTab(tabs)).toBe(1);
  });

  it("ignores a normal-looking url on a tab with no id", () => {
    expect(pickBestNormalTab([{ url: "https://example.com/" }])).toBeNull();
  });

  it("returns null for an empty tab list", () => {
    expect(pickBestNormalTab([])).toBeNull();
  });
});

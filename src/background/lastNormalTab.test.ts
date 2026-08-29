import { beforeEach, describe, expect, it } from "vitest";
import { forgetTab, getLastNormalTabId, noteTabUrl } from "./lastNormalTab";

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

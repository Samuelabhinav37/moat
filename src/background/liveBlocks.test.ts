import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const { forgetLive, getBlockedHosts, getLiveCount, isCountableBlock, isStandInRedirect, recordError, resetLive } = await import("./liveBlocks");

const blocked = (over: Partial<{ tabId: number; type: string; error: string; timeStamp: number; url: string }> = {}) => ({
  tabId: 3,
  type: "script",
  error: "net::ERR_BLOCKED_BY_CLIENT",
  timeStamp: 2000,
  ...over,
});

describe("isCountableBlock", () => {
  it("counts a refused sub-resource of the current page", () => {
    expect(isCountableBlock(blocked(), 1000)).toBe(true);
  });

  it("ignores other errors, background requests, top-level navigations and the previous page", () => {
    expect(isCountableBlock(blocked({ error: "net::ERR_CONNECTION_RESET" }), 1000)).toBe(false);
    expect(isCountableBlock(blocked({ tabId: -1 }), 1000)).toBe(false);
    expect(isCountableBlock(blocked({ type: "main_frame" }), 1000)).toBe(false);
    expect(isCountableBlock(blocked({ timeStamp: 500 }), 1000)).toBe(false);
  });
});

describe("per-tab live count", () => {
  beforeEach(() => forgetLive(3));

  it("counts, resets on a new page, and reports each counted tab", () => {
    const counted: number[] = [];
    resetLive(3, 1000);
    recordError(blocked(), (t) => counted.push(t));
    recordError(blocked({ type: "image" }), (t) => counted.push(t));
    recordError(blocked({ error: "net::ERR_ABORTED" }), (t) => counted.push(t));
    expect(getLiveCount(3)).toBe(2);
    expect(counted).toEqual([3, 3]);
    resetLive(3, 5000);
    expect(getLiveCount(3)).toBe(0);
    recordError(blocked({ timeStamp: 4000 }), () => {});
    expect(getLiveCount(3)).toBe(0);
  });

  it("keeps the new page's blocks when they arrive before its reset", () => {
    resetLive(3, 1000);
    recordError(blocked({ timeStamp: 1500 }), () => {}); // previous page
    recordError(blocked({ timeStamp: 5200 }), () => {}); // new page, reported early
    resetLive(3, 5000); // the new page's commit reaches the worker late
    expect(getLiveCount(3)).toBe(1);
  });
});

describe("isStandInRedirect", () => {
  it("recognises a swap to one of Moat's stand-in files, whatever the (dynamic) host", () => {
    expect(isStandInRedirect("chrome-extension://1f2e3d4c-dynamic/web-accessible-resources/redirects/googletagservices-gpt.js")).toBe(true);
    expect(isStandInRedirect("moz-extension://uuid/web-accessible-resources/redirects/noopjson.json")).toBe(true);
  });
  it("ignores ordinary redirects and other extension files", () => {
    expect(isStandInRedirect("https://example.com/web-accessible-resources/redirects/x.js")).toBe(false);
    expect(isStandInRedirect("chrome-extension://abc/popup.html")).toBe(false);
  });
});

describe("blocked hosts and pages", () => {
  beforeEach(() => forgetLive(7));

  it("tallies the blocked request hosts of the current page, and starts again on a new page", () => {
    recordError(blocked({ tabId: 7, url: "https://stats.g.doubleclick.net/x" }), () => {});
    recordError(blocked({ tabId: 7, url: "https://stats.g.doubleclick.net/y" }), () => {});
    recordError(blocked({ tabId: 7, url: "https://www.google-analytics.com/collect" }), () => {});
    recordError(blocked({ tabId: 7, url: "not a url" }), () => {});
    expect(Object.fromEntries(getBlockedHosts(7))).toEqual({ "stats.g.doubleclick.net": 2, "www.google-analytics.com": 1 });
    expect(getLiveCount(7)).toBe(4);
    resetLive(7, 5000);
    expect(getBlockedHosts(7).size).toBe(0);
  });

  it("reports a whole blocked page separately and doesn't count it as a block on the page", () => {
    const pages: string[] = [];
    recordError(blocked({ tabId: 7, type: "main_frame", url: "https://paypa1-secure.top/" }), () => {}, (block) => pages.push(`${block.tabId} ${block.url}`));
    expect(pages).toEqual(["7 https://paypa1-secure.top/"]);
    expect(getLiveCount(7)).toBe(0);
  });
});

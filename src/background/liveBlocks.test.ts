import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const { forgetLive, getLiveCount, isCountableBlock, isStandInRedirect, recordError, resetLive } = await import("./liveBlocks");

const blocked = (over: Partial<{ tabId: number; type: string; error: string; timeStamp: number }> = {}) => ({
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

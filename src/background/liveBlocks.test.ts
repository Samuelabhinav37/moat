import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const { blockedAddress, forgetLive, getBlockedHosts, getLiveCount, getPageHost, isCountableBlock, isStandInRedirect, recordError, resetLive } = await import("./liveBlocks");

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
    recordError(blocked({ url: "https://ads.example/a.js" }), (t) => counted.push(t));
    recordError(blocked({ type: "image", url: "https://ads.example/p.gif" }), (t) => counted.push(t));
    recordError(blocked({ error: "net::ERR_ABORTED", url: "https://ads.example/b.js" }), (t) => counted.push(t));
    expect(getLiveCount(3)).toBe(2);
    expect(counted).toEqual([3, 3]);
    resetLive(3, 5000);
    expect(getLiveCount(3)).toBe(0);
    recordError(blocked({ timeStamp: 4000 }), () => {});
    expect(getLiveCount(3)).toBe(0);
  });

  it("keeps the new page's blocks when they arrive before its reset", () => {
    resetLive(3, 1000);
    recordError(blocked({ timeStamp: 1500, url: "https://ads.example/old" }), () => {}); // previous page
    recordError(blocked({ timeStamp: 5200, url: "https://ads.example/new" }), () => {}); // new page, reported early
    resetLive(3, 5000); // the new page's commit reaches the worker late
    expect(getLiveCount(3)).toBe(1);
  });

  it("counts a blocked address once however often the page retries it, whatever the query", () => {
    const counted: number[] = [];
    resetLive(3, 1000);
    for (let i = 0; i < 100; i++) recordError(blocked({ timeStamp: 2000 + i, url: `https://chatgpt.com/ces/v1/t?n=${i}` }), (t) => counted.push(t));
    recordError(blocked({ timeStamp: 3000, url: "https://chatgpt.com/ces/v1/p" }), (t) => counted.push(t));
    expect(getLiveCount(3)).toBe(2);
    expect(counted).toHaveLength(2);
  });

  it("remembers the page's own host", () => {
    resetLive(3, 1000, "https://chatgpt.com/c/123");
    expect(getPageHost(3)).toBe("chatgpt.com");
  });
});

describe("blockedAddress", () => {
  it("is host and path, without query or fragment", () => {
    expect(blockedAddress("https://a.example/x/y?z=1#f")).toBe("a.example/x/y");
    expect(blockedAddress("not a url")).toBeNull();
    expect(blockedAddress(undefined)).toBeNull();
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
    recordError(blocked({ tabId: 7, url: "https://www.google-analytics.com/collect?v=2" }), () => {});
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

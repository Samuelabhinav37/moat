import { beforeEach, describe, expect, it, vi } from "vitest";

const action = vi.hoisted(() => ({ setBadgeText: vi.fn(async (_details: { tabId: number; text: string }) => {}), setBadgeBackgroundColor: vi.fn(async () => {}) }));
const webRequest = vi.hoisted(() => ({ onErrorOccurred: { addListener: () => {} }, onBeforeRedirect: { addListener: () => {} } }));
vi.mock("webextension-polyfill", () => ({ default: { action, webRequest } }));
vi.mock("./matchStats", () => ({
  getBreakdown: vi.fn(() => ({ ads: 0, trackers: 0, popups: 0 })),
  getCompanyBreakdown: vi.fn(() => ({})),
  refreshBreakdown: vi.fn(async () => {}),
  resetBreakdown: vi.fn(),
  forgetTab: vi.fn(),
}));
vi.mock("./usageStats", () => ({ recordBlockKinds: vi.fn(async () => {}), recordBlockedTotal: vi.fn(async () => {}), recordCompanyMatches: vi.fn(async () => {}), recordPurposes: vi.fn(async () => {}) }));
vi.mock("./blockedPage", () => ({ explainBlockedPage: vi.fn() }));
vi.mock("./trackerTable", () => ({ loadTrackerTable: vi.fn(async () => null), trackerTableNow: vi.fn(() => null) }));

const { combinedTotal, forgetTab, onSamePageNavigation, onTabShown, resetForNavigation } = await import("./blockStats");
const { recordError, startLiveBlockCounting } = await import("./liveBlocks");
startLiveBlockCounting(() => {});

const block = (tabId: number, url: string, timeStamp: number) => recordError({ tabId, type: "script", error: "net::ERR_BLOCKED_BY_CLIENT", timeStamp, url }, () => {});

describe("single-page apps", () => {
  beforeEach(() => forgetTab(1));

  it("starts the count again when the app moves to a new path", () => {
    resetForNavigation(1, 1000, "https://chatgpt.com/");
    block(1, "https://chatgpt.com/ces/v1/t", 1100);
    block(1, "https://ab.chatgpt.com/v1/rgstr", 1200);
    expect(combinedTotal(1)).toBe(2);
    onSamePageNavigation(1, "https://chatgpt.com/c/abc", 2000);
    expect(combinedTotal(1)).toBe(0);
    block(1, "https://chatgpt.com/ces/v1/t", 2100);
    expect(combinedTotal(1)).toBe(1);
  });

  it("keeps counting when only the query or state changes", () => {
    resetForNavigation(1, 1000, "https://mail.google.com/mail/u/0/");
    block(1, "https://play.google.com/log", 1100);
    onSamePageNavigation(1, "https://mail.google.com/mail/u/0/?tab=rm", 2000);
    expect(combinedTotal(1)).toBe(1);
  });
});

describe("badge", () => {
  it("paints only the tab shown in its window", async () => {
    onTabShown(5, 1);
    action.setBadgeText.mockClear();
    resetForNavigation(6, 1000, "https://hidden.example/");
    resetForNavigation(5, 1000, "https://shown.example/");
    await Promise.resolve();
    expect(action.setBadgeText.mock.calls.map(([arg]) => arg.tabId)).toEqual([5]);
    onTabShown(6, 1);
    await Promise.resolve();
    expect(action.setBadgeText.mock.calls.map(([arg]) => arg.tabId)).toEqual([5, 6]);
  });
});

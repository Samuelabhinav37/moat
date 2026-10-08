import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (details: unknown) => void;
const listeners = vi.hoisted(() => [] as Listener[]);
vi.mock("webextension-polyfill", () => ({
  default: { webRequest: { onHeadersReceived: { addListener: (fn: Listener) => listeners.push(fn) } } },
}));

import { blobWorkersAllowed, forgetTab, HEADERS_WAIT_MS, startFrameCspTracking } from "./frameCsp";

startFrameCspTracking();
const respond = (tabId: number, frameId: number, url: string, csp?: string, header = "Content-Security-Policy"): void =>
  listeners[0]!({
    tabId,
    frameId,
    url,
    type: frameId === 0 ? "main_frame" : "sub_frame",
    responseHeaders: csp === undefined ? [] : [{ name: header, value: csp }],
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("frameCsp", () => {
  it("answers per tab, frame and document from the response's CSP headers", async () => {
    respond(1, 0, "https://a.example/");
    respond(1, 5, "https://b.example/frame", "worker-src 'self'");
    expect(await blobWorkersAllowed(1, 0, "https://a.example/#top")).toBe(true);
    expect(await blobWorkersAllowed(1, 5, "https://b.example/frame")).toBe(false);
  });

  it("counts report-only policies, which would send the site a report", async () => {
    respond(2, 0, "https://a.example/", "default-src 'self'", "content-security-policy-report-only");
    expect(await blobWorkersAllowed(2, 0, "https://a.example/")).toBe(false);
  });

  it("waits for headers that arrive after the question", async () => {
    const answer = blobWorkersAllowed(3, 0, "https://late.example/");
    respond(3, 0, "https://late.example/");
    expect(await answer).toBe(true);
  });

  it("never answers with the previous page's headers", async () => {
    vi.useFakeTimers();
    respond(4, 0, "https://open.example/");
    const answer = blobWorkersAllowed(4, 0, "https://strict.example/");
    await vi.advanceTimersByTimeAsync(HEADERS_WAIT_MS + 10);
    expect(await answer).toBe(false);
  });

  it("says no for unknown frames, non-web documents and forgotten tabs", async () => {
    vi.useFakeTimers();
    expect(await blobWorkersAllowed(undefined, 0, "https://a.example/")).toBe(false);
    expect(await blobWorkersAllowed(5, 0, "about:blank")).toBe(false);
    respond(5, 0, "https://a.example/");
    forgetTab(5);
    const answer = blobWorkersAllowed(5, 0, "https://a.example/");
    await vi.advanceTimersByTimeAsync(HEADERS_WAIT_MS + 10);
    expect(await answer).toBe(false);
  });
});

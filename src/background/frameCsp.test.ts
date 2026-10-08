import { describe, expect, it, vi } from "vitest";

type Listener = (details: unknown) => void;
const listeners = vi.hoisted(() => [] as Listener[]);
vi.mock("webextension-polyfill", () => ({
  default: { webRequest: { onHeadersReceived: { addListener: (fn: Listener) => listeners.push(fn) } } },
}));

import { blobWorkersAllowed, forgetTab, startFrameCspTracking } from "./frameCsp";

startFrameCspTracking();
const respond = (tabId: number, frameId: number, csp?: string, header = "Content-Security-Policy"): void =>
  listeners[0]!({
    tabId,
    frameId,
    type: frameId === 0 ? "main_frame" : "sub_frame",
    responseHeaders: csp === undefined ? [] : [{ name: header, value: csp }],
  });

describe("frameCsp", () => {
  it("answers per tab and frame from the response's CSP headers", () => {
    respond(1, 0);
    respond(1, 5, "worker-src 'self'");
    expect(blobWorkersAllowed(1, 0)).toBe(true);
    expect(blobWorkersAllowed(1, 5)).toBe(false);
  });

  it("counts report-only policies, which would send the site a report", () => {
    respond(2, 0, "default-src 'self'", "content-security-policy-report-only");
    expect(blobWorkersAllowed(2, 0)).toBe(false);
  });

  it("says no when it has seen nothing, and forgets a new page's old frames", () => {
    expect(blobWorkersAllowed(3, 0)).toBe(false);
    expect(blobWorkersAllowed(undefined, 0)).toBe(false);
    respond(4, 0);
    respond(4, 7);
    respond(4, 0, "script-src 'self'");
    expect(blobWorkersAllowed(4, 0)).toBe(false);
    expect(blobWorkersAllowed(4, 7)).toBe(false);
    respond(4, 0);
    forgetTab(4);
    expect(blobWorkersAllowed(4, 0)).toBe(false);
  });
});

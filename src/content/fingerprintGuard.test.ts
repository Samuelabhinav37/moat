// @vitest-environment jsdom
//
// Prototypes get mutated in place by the module under test, and every `it()`
// in this file shares one jsdom window (vitest isolates per test *file*, not
// per test case) -- so each test uses its own guardToken. A stale listener
// from an earlier test's module instance locks onto that test's token and
// will reject every later test's messages as a token mismatch, which keeps
// old instances from reacting to (and re-wrapping) a later test's config
// messages. The patched descriptor itself is restored after each test so
// "untouched" assertions don't depend on test order.
//
// Asserts against Navigator.prototype.hardwareConcurrency, not canvas/audio/
// WebGL: jsdom doesn't implement CanvasRenderingContext2D/AudioBuffer/WebGL
// at all (see fingerprintNoise.ts's own header comment), so patchCanvas()
// throws in this environment -- exactly the kind of per-surface failure
// ensurePatched()'s try/catch isolation is meant to survive without stopping
// the other patches, hardwareConcurrency included.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeMessage } from "../types";

const nativeHardwareConcurrencyDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "hardwareConcurrency"
)!;

function postConfig(fingerprintResistance: boolean, guardToken: string): void {
  const message: BridgeMessage = {
    source: "moat",
    type: "config",
    disabled: false,
    fingerprintResistance,
    fingerprintSeed: "test-seed",
    guardToken,
  };
  // Not window.postMessage(): jsdom's implementation doesn't set the
  // delivered MessageEvent's `source` to `window` for a same-window post
  // (real browsers do), which fingerprintGuard.ts's `event.source !== window`
  // check depends on. Dispatching the event directly with an explicit
  // `source` reproduces what a real browser actually delivers.
  window.dispatchEvent(new MessageEvent("message", { data: message, source: window as unknown as MessageEventSource }));
}

function isPatched(): boolean {
  return Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency")?.get !== nativeHardwareConcurrencyDescriptor.get;
}

describe("fingerprintGuard: lazy prototype patching", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", nativeHardwareConcurrencyDescriptor);
  });

  it("does not touch navigator hints at all just from being imported", async () => {
    await import("./fingerprintGuard");
    expect(isPatched()).toBe(false);
  });

  it("still leaves it untouched after a config message reporting fingerprintResistance: false", async () => {
    await import("./fingerprintGuard");
    postConfig(false, "token-off");
    expect(isPatched()).toBe(false);
  });

  it("patches navigator hints the first time a config message reports fingerprintResistance: true", async () => {
    await import("./fingerprintGuard");
    postConfig(true, "token-on");
    expect(isPatched()).toBe(true);
  });

  it("patches lazily even if the feature only turns on after an initial off message (mid-session toggle)", async () => {
    await import("./fingerprintGuard");
    postConfig(false, "token-toggle");
    expect(isPatched()).toBe(false);

    postConfig(true, "token-toggle");
    expect(isPatched()).toBe(true);
  });

  it("does not re-patch on a second true message (patches exactly once)", async () => {
    await import("./fingerprintGuard");
    postConfig(true, "token-once");
    const wrapped = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency")?.get;

    postConfig(true, "token-once");
    expect(Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency")?.get).toBe(wrapped);
  });
});

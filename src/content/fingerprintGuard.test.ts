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

// window.innerWidth/innerHeight are own properties of the window instance in
// jsdom (confirmed directly, not assumed -- unlike Navigator.prototype's
// hardwareConcurrency/deviceMemory, which really are shared-prototype
// getters), so these patch/restore against `window` itself, not a
// prototype. Performance.prototype.now and Date.now ARE real, jsdom-backed
// APIs (unlike canvas/audio/WebGL, which jsdom doesn't implement at all),
// so this is the other pair of new patches this file can actually exercise.
describe("fingerprintGuard: dimension and timing spoofing", () => {
  const nativeInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth")!;
  const nativeDateNow = Date.now;
  const nativeTimeStamp = Object.getOwnPropertyDescriptor(Event.prototype, "timeStamp")!;

  beforeEach(() => {
    vi.resetModules();
    // jsdom's own innerWidth descriptor is a getter, not a value property --
    // spreading it plus a `value` key throws ("cannot both specify accessors
    // and a value"), so this replaces the getter itself instead.
    Object.defineProperty(window, "innerWidth", { ...nativeInnerWidth, get: () => 1920, configurable: true });
    // A fixed, non-multiple-of-100 system time makes the clamping tests
    // exact instead of relying on the real wall clock happening not to land
    // on a 100ms boundary (a ~1% chance of flaking otherwise).
    vi.useFakeTimers();
    vi.setSystemTime(1234567);
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", nativeInnerWidth);
    vi.useRealTimers();
    Date.now = nativeDateNow;
    Object.defineProperty(Event.prototype, "timeStamp", nativeTimeStamp);
  });

  it("reports the real window width until fingerprintResistance turns on", async () => {
    await import("./fingerprintGuard");
    expect(window.innerWidth).toBe(1920);
    postConfig(true, "dims-token");
    // 1920 floors to Tor's 200px bucket, then hits the 1000px cap (see
    // fingerprintNoise.ts's own comment on why that's the common case for
    // any real, non-Tor window, not an edge case).
    expect(window.innerWidth).toBe(1000);
  });

  // patchTiming() also reassigns Performance.prototype.now (the same
  // maskAsNative reassignment pattern as everything else here), but that
  // specific one isn't verifiable in this harness: vitest's jsdom
  // environment backs the global `performance` object with Node's own
  // perf_hooks implementation, whose prototype chain is a *different*
  // object than the in-scope `Performance` constructor (confirmed directly
  // -- `Object.getPrototypeOf(performance) !== Performance.prototype` here,
  // despite `performance === window.performance` being true). Real browsers
  // don't have this split; it's a test-harness-only gap, the same class of
  // limitation as this file's header comment already documents for canvas/
  // audio/WebGL. Date.now and Event.prototype.timeStamp aren't shadowed
  // this way, so they cover the same clamping logic instead.
  it("clamps Date.now() and Event.prototype.timeStamp to the nearest 100ms once active", async () => {
    await import("./fingerprintGuard");
    expect(Date.now()).toBe(1234567);
    expect(new Event("x").timeStamp).toBe(1234567);

    postConfig(true, "timing-token");
    expect(Date.now()).toBe(1234500);
    expect(new Event("x").timeStamp).toBe(1234500);
  });

  it("stops clamping once patched functions see fingerprintResistance: false again", async () => {
    await import("./fingerprintGuard");
    postConfig(true, "toggle-token");
    expect(Date.now()).toBe(1234500);

    postConfig(false, "toggle-token");
    // The patch itself is never removed (ensurePatched() patches exactly
    // once, per the describe block above) -- `active` gates behavior inside
    // it, so a real, unclamped value should read through again.
    expect(Date.now()).toBe(1234567);
  });
});

// Runs in the page's MAIN world at document_start, like mainWorldGuard.ts,
// but is a separate script: this is the one opt-in, occasionally-risky
// feature in the extension (it can change what a page observes, e.g. a
// canvas CAPTCHA), so it's kept independently toggleable and easy to
// reason about on its own.
//
// Inactive (does nothing, and patches nothing) until a "config" message from
// bridge.ts reports fingerprintResistance: true -- which only happens when
// the user has opted in via Settings and the site isn't paused. See
// ensurePatched() below: the canvas/audio/WebGL/navigator prototypes are
// only ever touched the first time that happens, not unconditionally at
// load, since the feature is off by default and patching has a real
// per-call cost every page would otherwise pay for nothing.
import {
  bucketDeviceMemory,
  bucketHardwareConcurrency,
  bucketHeight,
  bucketWidth,
  clampTimestamp,
  noisifyFloatSamples,
  noisifyRGBA,
  SPOOFED_AUDIO_OUTPUT_LATENCY,
  SPOOFED_AUDIO_SAMPLE_RATE,
  SPOOFED_WEBGL_RENDERER,
  SPOOFED_WEBGL_VENDOR,
  UNMASKED_RENDERER_WEBGL,
  UNMASKED_VENDOR_WEBGL,
} from "./fingerprintNoise";
import { maskAsNative } from "./nativeToString";
import type { BridgeMessage } from "../types";

let seed = "";
let active = false;

// Trust-on-first-use: the first "config" message this page load sees locks
// in its guardToken, and later messages are only applied if they carry the
// same one. Same-window postMessage has no real origin check available, so
// a page can still eavesdrop the real message and learn the token -- this
// only raises the cost from a zero-effort spoof to "must observe first".
let lockedGuardToken: string | null = null;

function canvasSeed(width: number, height: number): string {
  return `${seed}:canvas:${width}x${height}`;
}

function patchCanvas(): void {
  const canvasProto = HTMLCanvasElement.prototype;
  const ctxProto = CanvasRenderingContext2D.prototype;
  const nativeToDataURL = canvasProto.toDataURL;
  const nativeToBlob = canvasProto.toBlob;
  const nativeGetImageData = ctxProto.getImageData;

  // Renders onto a same-sized off-screen clone via the *native* (unpatched)
  // methods, noises that clone's pixels, and reads back from the clone --
  // the on-screen canvas the page actually displays is never touched.
  function noisedClone(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const clone = document.createElement("canvas");
    clone.width = canvas.width;
    clone.height = canvas.height;
    const ctx = clone.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(canvas, 0, 0);
    if (!active) return clone;
    const imageData = nativeGetImageData.call(ctx, 0, 0, clone.width, clone.height);
    noisifyRGBA(imageData.data, canvasSeed(clone.width, clone.height));
    ctx.putImageData(imageData, 0, 0);
    return clone;
  }

  canvasProto.toDataURL = function guardedToDataURL(
    this: HTMLCanvasElement,
    ...args: Parameters<typeof nativeToDataURL>
  ): string {
    if (!active) return nativeToDataURL.apply(this, args);
    return nativeToDataURL.apply(noisedClone(this), args);
  };

  canvasProto.toBlob = function guardedToBlob(
    this: HTMLCanvasElement,
    ...args: Parameters<typeof nativeToBlob>
  ): void {
    if (!active) {
      nativeToBlob.apply(this, args);
      return;
    }
    nativeToBlob.apply(noisedClone(this), args);
  };

  ctxProto.getImageData = function guardedGetImageData(
    this: CanvasRenderingContext2D,
    ...args: Parameters<typeof nativeGetImageData>
  ): ImageData {
    const imageData = nativeGetImageData.apply(this, args);
    if (active) noisifyRGBA(imageData.data, canvasSeed(this.canvas.width, this.canvas.height));
    return imageData;
  };

  maskAsNative(canvasProto.toDataURL, nativeToDataURL);
  maskAsNative(canvasProto.toBlob, nativeToBlob);
  maskAsNative(ctxProto.getImageData, nativeGetImageData);
}

function patchAudio(): void {
  if (typeof AudioBuffer !== "undefined") {
    const proto = AudioBuffer.prototype;
    const nativeGetChannelData = proto.getChannelData;

    proto.getChannelData = function guardedGetChannelData(
      this: AudioBuffer,
      ...args: Parameters<typeof nativeGetChannelData>
    ): ReturnType<typeof nativeGetChannelData> {
      const data = nativeGetChannelData.apply(this, args);
      if (active) noisifyFloatSamples(data, `${seed}:audio:${args[0]}`);
      return data;
    };

    maskAsNative(proto.getChannelData, nativeGetChannelData);
  }

  // Separate global, separate guard: AudioBuffer (buffer contents, noised
  // above) and AudioContext (device-level properties, spoofed to a fixed
  // value below) are different fingerprinting vectors -- see the research
  // doc's own distinction between Moat's existing noisifyFloatSamples and
  // Firefox's actual shipped outputLatency/sampleRate spoofing.
  if (typeof AudioContext !== "undefined") {
    patchFixedGetter(AudioContext.prototype, "sampleRate", () => SPOOFED_AUDIO_SAMPLE_RATE);
    patchFixedGetter(AudioContext.prototype, "outputLatency", () => SPOOFED_AUDIO_OUTPUT_LATENCY);
  }
}

/** Shared by patchAudio above: replaces a getter with one that returns a
 * fixed value while `active` and the real value otherwise, masked the same
 * way every other patched function/getter in this file already is. `object`
 * is typed loosely since TypeScript's lib.dom.d.ts doesn't universally
 * expose every property this file patches (e.g.
 * AudioContext.prototype.outputLatency isn't in every TS lib target) as a
 * statically-known key. */
function patchFixedGetter(object: object, property: string, compute: () => number): void {
  const native = Object.getOwnPropertyDescriptor(object, property);
  if (!native?.get) return;
  const nativeGetter = native.get;
  const guardedGetter = function guardedGetter(this: unknown) {
    if (active) return compute();
    return nativeGetter.call(this);
  };
  Object.defineProperty(object, property, { ...native, get: guardedGetter });
  maskAsNative(guardedGetter, nativeGetter);
}

/** Shared by patchDimensions/patchScreen/patchTiming below: replaces a
 * getter with one that runs the REAL value through `transform` while
 * `active`, and returns the real value untouched otherwise -- unlike
 * patchFixedGetter above, the reported value still depends on the actual
 * one (a bucketed/clamped derivative of it), it just never reveals the
 * precise original. */
function patchTransformedGetter(object: object, property: string, transform: (actual: number) => number): void {
  const native = Object.getOwnPropertyDescriptor(object, property);
  if (!native?.get) return;
  const nativeGetter = native.get;
  const guardedGetter = function guardedGetter(this: unknown) {
    const actual = nativeGetter.call(this) as number;
    return active ? transform(actual) : actual;
  };
  Object.defineProperty(object, property, { ...native, get: guardedGetter });
  maskAsNative(guardedGetter, nativeGetter);
}

// window.innerWidth/innerHeight/outerWidth/outerHeight are the page's own
// window instance's OWN properties in every engine checked (not inherited
// via a shared Window.prototype getter the way Navigator.prototype's
// hardwareConcurrency/deviceMemory are) -- patched directly on `window`
// itself, still the same guarded-getter shape. screen.width/height/
// availWidth/availHeight, by contrast, genuinely are Screen.prototype
// getters, same pattern as patchNavigatorHints above.
//
// Property-level lie only, stated plainly: this makes the documented JS
// getters real fingerprint scripts actually read report Tor's own 200x100
// bucket instead of the true pixel size. It does NOT touch actual page
// layout -- CSS media queries, viewport units, and getBoundingClientRect()
// on real DOM elements all still reflect the true window size, so a script
// that cross-checks the spoofed values against observed layout behavior can
// catch the inconsistency. Same category of limitation Moat's existing
// canvas/WebGL spoofs already accept, not a new risk class.
function patchDimensions(): void {
  for (const prop of ["innerWidth", "outerWidth"] as const) {
    patchTransformedGetter(window, prop, bucketWidth);
  }
  for (const prop of ["innerHeight", "outerHeight"] as const) {
    patchTransformedGetter(window, prop, bucketHeight);
  }
}

function patchScreenDimensions(): void {
  if (typeof Screen === "undefined") return;
  patchTransformedGetter(Screen.prototype, "width", bucketWidth);
  patchTransformedGetter(Screen.prototype, "availWidth", bucketWidth);
  patchTransformedGetter(Screen.prototype, "height", bucketHeight);
  patchTransformedGetter(Screen.prototype, "availHeight", bucketHeight);
}

// Real, disclosed tradeoff (see clampTimestamp's own comment in
// fingerprintNoise.ts): code measuring frame-to-frame deltas via
// performance.now() (animation loops, scroll physics) can see a run of
// zero-length deltas within the same 100ms bucket. The same visible-jank
// tradeoff Firefox's own resistFingerprinting already carries in
// production -- not a new risk class this introduces, but real enough to
// state here rather than only in a research doc.
function patchTiming(): void {
  if (typeof Performance !== "undefined") {
    const nativeNow = Performance.prototype.now;
    Performance.prototype.now = function guardedNow(this: Performance): number {
      const actual = nativeNow.call(this);
      return active ? clampTimestamp(actual) : actual;
    };
    maskAsNative(Performance.prototype.now, nativeNow);
  }

  const nativeDateNow = Date.now;
  Date.now = function guardedDateNow(): number {
    const actual = nativeDateNow();
    return active ? clampTimestamp(actual) : actual;
  };
  maskAsNative(Date.now, nativeDateNow);

  if (typeof Event !== "undefined") {
    patchTransformedGetter(Event.prototype, "timeStamp", clampTimestamp);
  }
}

function patchWebGL(): void {
  const contexts = [
    typeof WebGLRenderingContext === "undefined" ? undefined : WebGLRenderingContext,
    typeof WebGL2RenderingContext === "undefined" ? undefined : WebGL2RenderingContext,
  ];
  for (const ctor of contexts) {
    if (!ctor) continue;
    const nativeGetParameter = ctor.prototype.getParameter;
    ctor.prototype.getParameter = function guardedGetParameter(
      this: WebGLRenderingContext,
      pname: number
    ): ReturnType<typeof nativeGetParameter> {
      if (active) {
        if (pname === UNMASKED_VENDOR_WEBGL) return SPOOFED_WEBGL_VENDOR;
        if (pname === UNMASKED_RENDERER_WEBGL) return SPOOFED_WEBGL_RENDERER;
      }
      return nativeGetParameter.call(this, pname);
    };
    maskAsNative(ctor.prototype.getParameter, nativeGetParameter);
  }
}

function patchNavigatorHints(): void {
  const nativeConcurrency = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency");
  const nativeMemory = Object.getOwnPropertyDescriptor(
    Navigator.prototype as Navigator & { deviceMemory?: number },
    "deviceMemory"
  );

  if (nativeConcurrency?.get) {
    const guardedGetter = function guardedHardwareConcurrency(this: Navigator) {
      const actual = nativeConcurrency.get!.call(this) as number;
      return active ? bucketHardwareConcurrency(actual) : actual;
    };
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
      ...nativeConcurrency,
      get: guardedGetter,
    });
    maskAsNative(guardedGetter, nativeConcurrency.get);
  }

  if (nativeMemory?.get) {
    const guardedGetter = function guardedDeviceMemory(this: Navigator) {
      const actual = nativeMemory.get!.call(this) as number;
      return active ? bucketDeviceMemory(actual) : actual;
    };
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      ...nativeMemory,
      get: guardedGetter,
    });
    maskAsNative(guardedGetter, nativeMemory.get);
  }
}

// Patching every one of these prototypes has a real per-call cost (an extra
// function-call indirection, plus a Function.prototype.toString side-table
// registration via maskAsNative) that every page pays whether or not
// fingerprint resistance is actually on -- and it's off by default, so most
// visitors were paying it for nothing. Deferred to the first config message
// that actually reports the feature on, instead of running unconditionally
// at parse time: `active` already gates *behavior* inside the patched
// functions, this just also gates whether they get patched at all.
let patched = false;

function ensurePatched(): void {
  if (patched) return;
  patched = true;
  // Each surface is independent -- one throwing (an unusual embedding
  // context missing a global this file assumes) must not stop the others
  // from installing. Previously these ran unconditionally at parse time
  // with the same lack of isolation between them; grouping them here is
  // what makes that pre-existing gap worth closing now.
  for (const patch of [patchCanvas, patchAudio, patchWebGL, patchNavigatorHints, patchDimensions, patchScreenDimensions, patchTiming]) {
    try {
      patch();
    } catch {
      // Best-effort: losing noise on one surface is better than losing it
      // on every surface over one missing global.
    }
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeMessage | undefined;
  if (!data || data.source !== "moat" || data.type !== "config") return;
  if (lockedGuardToken === null) lockedGuardToken = data.guardToken;
  if (data.guardToken !== lockedGuardToken) return;
  active = data.fingerprintResistance;
  seed = data.fingerprintSeed;
  // Patch as soon as the feature is ever turned on for this page load --
  // covers both "already on at load" and "the user flips it on mid-session"
  // (bridge.ts re-sends config on a storage change). Once patched, later
  // messages just keep updating `active`/`seed` above; a later "off"
  // message correctly leaves the (now-dormant) patches in place rather than
  // trying to unpatch, same as before this change.
  if (active) ensurePatched();
});

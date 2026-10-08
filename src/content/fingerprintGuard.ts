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
import { maskAsNative, maskRealm, nativeGetter, nativeMethod } from "./nativeToString";
import { workerGuardPrelude } from "./workerGuard";
import { cspAllowsBlobWorkers } from "../shared/cspBlobWorkers";
import { GUARD_CONNECT_EVENT, type FingerprintGuardConfig } from "../types";

let seed = "";
let active = false;
/** The page's CSP headers allow blob: workers (from bridge.ts). */
let blobWorkers = false;

// Taken now, at document_start, before any page script can wrap them: the
// worker bootstrap below carries the seed, and a page that hooked Blob or
// createObjectURL would read it.
const NativeBlob = Blob;
const nativeCreateObjectURL = URL.createObjectURL;
const nativeRevokeObjectURL = URL.revokeObjectURL;
const WORKER_PRELUDE = workerGuardPrelude.toString();

/** The page's window, or a same-origin frame's (see ensurePatched). */
type GuardWindow = Window & typeof globalThis;

// Private channel to bridge.ts (the second port of GUARD_CONNECT_EVENT, see
// types.ts). The seed only ever travels over it, so page scripts can't read
// it and undo the noise.
let bridgePort: MessagePort | null = null;

function canvasSeed(width: number, height: number): string {
  return `${seed}:canvas:${width}x${height}`;
}

function patchCanvas(w: GuardWindow): void {
  const canvasProto = w.HTMLCanvasElement.prototype;
  const ctxProto = w.CanvasRenderingContext2D.prototype;
  const nativeToDataURL = canvasProto.toDataURL;
  const nativeToBlob = canvasProto.toBlob;
  const nativeGetImageData = ctxProto.getImageData;

  // Renders onto a same-sized off-screen clone via the *native* (unpatched)
  // methods, noises that clone's pixels, and reads back from the clone --
  // the on-screen canvas the page actually displays is never touched.
  function noisedClone(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const clone = (canvas.ownerDocument ?? w.document).createElement("canvas");
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

  canvasProto.toDataURL = nativeMethod<typeof nativeToDataURL>(nativeToDataURL, function guardedToDataURL(
    this: HTMLCanvasElement,
    ...args: Parameters<typeof nativeToDataURL>
  ): string {
    if (!active) return nativeToDataURL.apply(this, args);
    return nativeToDataURL.apply(noisedClone(this), args);
  });

  canvasProto.toBlob = nativeMethod<typeof nativeToBlob>(nativeToBlob, function guardedToBlob(
    this: HTMLCanvasElement,
    ...args: Parameters<typeof nativeToBlob>
  ): void {
    if (!active) {
      nativeToBlob.apply(this, args);
      return;
    }
    nativeToBlob.apply(noisedClone(this), args);
  });

  ctxProto.getImageData = nativeMethod<typeof nativeGetImageData>(nativeGetImageData, function guardedGetImageData(
    this: CanvasRenderingContext2D,
    ...args: Parameters<typeof nativeGetImageData>
  ): ImageData {
    const imageData = nativeGetImageData.apply(this, args);
    if (active) noisifyRGBA(imageData.data, canvasSeed(this.canvas.width, this.canvas.height));
    return imageData;
  });
}

/** Same noise for OffscreenCanvas in the page itself (workers: workerGuard.ts). */
function patchOffscreenCanvas(w: GuardWindow): void {
  if (typeof w.OffscreenCanvas === "undefined" || typeof w.OffscreenCanvasRenderingContext2D === "undefined") return;
  const canvasProto = w.OffscreenCanvas.prototype;
  const ctxProto = w.OffscreenCanvasRenderingContext2D.prototype;
  const nativeConvertToBlob = canvasProto.convertToBlob;
  const nativeGetImageData = ctxProto.getImageData;
  const Offscreen = w.OffscreenCanvas;

  canvasProto.convertToBlob = nativeMethod<typeof nativeConvertToBlob>(nativeConvertToBlob, function guardedConvertToBlob(
    this: OffscreenCanvas,
    ...args: Parameters<typeof nativeConvertToBlob>
  ): Promise<Blob> {
    const { width, height } = this;
    const clone = active && width > 0 && height > 0 ? new Offscreen(width, height) : null;
    const ctx = clone?.getContext("2d");
    if (!clone || !ctx) return nativeConvertToBlob.apply(this, args);
    ctx.drawImage(this, 0, 0);
    const imageData = nativeGetImageData.call(ctx, 0, 0, width, height);
    noisifyRGBA(imageData.data, canvasSeed(width, height));
    ctx.putImageData(imageData, 0, 0);
    return nativeConvertToBlob.apply(clone, args);
  });

  ctxProto.getImageData = nativeMethod<typeof nativeGetImageData>(nativeGetImageData, function guardedGetImageData(
    this: OffscreenCanvasRenderingContext2D,
    ...args: Parameters<typeof nativeGetImageData>
  ): ImageData {
    const imageData = nativeGetImageData.apply(this, args);
    if (active) noisifyRGBA(imageData.data, canvasSeed(this.canvas.width, this.canvas.height));
    return imageData;
  });
}

// Blobs behind the page's own blob: URLs, so a worker started from one can
// be restarted from a fresh URL to the same Blob: pages often revoke the URL
// right after new Worker() returns, before the bootstrap would load it.
const pageBlobs = new Map<string, Blob>();

function patchBlobUrls(w: GuardWindow): void {
  const nativeCreate = w.URL.createObjectURL;
  const nativeRevoke = w.URL.revokeObjectURL;
  w.URL.createObjectURL = nativeMethod<typeof nativeCreate>(nativeCreate, function createObjectURL(
    this: unknown,
    object: Blob | MediaSource
  ): string {
    const url = nativeCreate.call(this, object);
    const tag = Object.prototype.toString.call(object);
    if (tag === "[object Blob]" || tag === "[object File]") pageBlobs.set(url, object as Blob);
    return url;
  });
  w.URL.revokeObjectURL = nativeMethod<typeof nativeRevoke>(nativeRevoke, function revokeObjectURL(this: unknown, url: string): void {
    pageBlobs.delete(String(url));
    nativeRevoke.call(this, url);
  });
}

function metaCspAllowsBlobWorkers(doc: Document): boolean {
  const policies = [...doc.querySelectorAll('meta[http-equiv="content-security-policy" i]')].map(
    (meta) => meta.getAttribute("content") ?? ""
  );
  return cspAllowsBlobWorkers(policies);
}

/** What to start instead of the page's worker: a blob: bootstrap running
 * workerGuardPrelude, then the page's script. Null leaves the worker as the
 * page asked: guard off, a CSP that forbids blob: workers, an address the
 * browser would refuse (it then throws just as it would have), or a page
 * blob: URL made before the guard turned on. */
function guardedWorkerArgs(w: GuardWindow, args: unknown[]): { args: unknown[]; cleanup: (worker: Worker) => void } | null {
  if (!active || !blobWorkers || args.length === 0) return null;
  const options = args[1] as WorkerOptions | undefined;
  if (options !== undefined && (typeof options !== "object" || options === null)) return null;
  const module = options?.type === "module";
  if (module && options?.credentials !== undefined && options.credentials !== "same-origin") return null;
  let address: URL;
  try {
    address = new URL(String(args[0]), w.document.baseURI);
  } catch {
    return null;
  }
  let scriptUrl = address.href;
  let pageBlobUrl: string | null = null;
  if (address.protocol === "blob:") {
    const blob = pageBlobs.get(address.href);
    if (!blob) return null;
    pageBlobUrl = scriptUrl = nativeCreateObjectURL(blob);
  } else if (!/^https?:$/.test(address.protocol) || address.origin !== w.origin) {
    return null;
  }
  if (!metaCspAllowsBlobWorkers(w.document)) {
    if (pageBlobUrl) nativeRevokeObjectURL(pageBlobUrl);
    return null;
  }
  const json = JSON.stringify;
  const blobUrl = (text: string): string => nativeCreateObjectURL(new NativeBlob([text], { type: "text/javascript" }));
  const prelude = `(${WORKER_PRELUDE})(${json(seed)},${json(address.href)},${json(WORKER_PRELUDE)});`;
  // URLs the worker fetches after it starts, revoked once it's running.
  const later = pageBlobUrl ? [pageBlobUrl] : [];
  let source: string;
  if (module) {
    // Static imports, run in order before the worker takes messages; an
    // awaited import() would let the page's first postMessage arrive
    // before its script set onmessage. The guard module revokes its own
    // URL as it runs, so the page can't fetch it back for the seed.
    const preludeUrl = blobUrl(`URL.revokeObjectURL(import.meta.url);${prelude}`);
    later.push(preludeUrl);
    source = `import ${json(preludeUrl)};\nimport ${json(scriptUrl)};`;
  } else {
    source = `${prelude}\nimportScripts(${json(scriptUrl)});`;
  }
  const bootstrap = blobUrl(source);
  return {
    args: [bootstrap, ...args.slice(1)],
    cleanup(worker) {
      // The worker holds the bootstrap from construction on.
      nativeRevokeObjectURL(bootstrap);
      if (later.length === 0) return;
      let timer = 0;
      const done = (): void => {
        clearTimeout(timer);
        for (const url of later) nativeRevokeObjectURL(url);
      };
      timer = setTimeout(done, 30_000) as unknown as number;
      worker.addEventListener("message", done, { once: true });
      worker.addEventListener("error", done, { once: true });
    },
  };
}

/** Starts the page's dedicated workers through guardedWorkerArgs, so
 * OffscreenCanvas, WebGL, navigator and clocks are guarded in there too.
 * SharedWorker isn't wrapped: a fresh blob: URL per call would stop tabs
 * sharing one, which is the point of it. */
function patchWorkers(w: GuardWindow): void {
  if (typeof w.Worker === "undefined") return;
  const NativeWorker = w.Worker;
  const proxy = new Proxy(NativeWorker, {
    construct(target, args: unknown[], newTarget) {
      const guarded = guardedWorkerArgs(w, args);
      if (guarded) {
        try {
          const worker = Reflect.construct(target, guarded.args, newTarget) as Worker;
          guarded.cleanup(worker);
          return worker;
        } catch {
          // e.g. Trusted Types refusing a plain string URL. Let the browser
          // handle the page's own arguments below.
          nativeRevokeObjectURL(String(guarded.args[0]));
        }
      }
      return Reflect.construct(target, args, newTarget) as Worker;
    },
  });
  maskAsNative(proxy, NativeWorker);
  const ownProp = Object.getOwnPropertyDescriptor(w, "Worker");
  if (ownProp) Object.defineProperty(w, "Worker", { ...ownProp, value: proxy });
  const constructorProp = Object.getOwnPropertyDescriptor(NativeWorker.prototype, "constructor");
  if (constructorProp) Object.defineProperty(NativeWorker.prototype, "constructor", { ...constructorProp, value: proxy });
}

function patchAudio(w: GuardWindow): void {
  if (typeof w.AudioBuffer !== "undefined") {
    const proto = w.AudioBuffer.prototype;
    const nativeGetChannelData = proto.getChannelData;

    proto.getChannelData = nativeMethod<typeof nativeGetChannelData>(nativeGetChannelData, function guardedGetChannelData(
      this: AudioBuffer,
      ...args: Parameters<typeof nativeGetChannelData>
    ): ReturnType<typeof nativeGetChannelData> {
      const data = nativeGetChannelData.apply(this, args);
      if (active) noisifyFloatSamples(data, `${seed}:audio:${args[0]}`);
      return data;
    });
  }

  // Separate global, separate guard: AudioBuffer (buffer contents, noised
  // above) and AudioContext (device-level properties, spoofed to a fixed
  // value below) are different fingerprinting vectors -- see the research
  // doc's own distinction between Moat's existing noisifyFloatSamples and
  // Firefox's actual shipped outputLatency/sampleRate spoofing.
  if (typeof w.AudioContext !== "undefined") {
    patchFixedGetter(w.AudioContext.prototype, "sampleRate", () => SPOOFED_AUDIO_SAMPLE_RATE);
    patchFixedGetter(w.AudioContext.prototype, "outputLatency", () => SPOOFED_AUDIO_OUTPUT_LATENCY);
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
  const realGetter = native.get;
  const guardedGetter = nativeGetter(property, realGetter, function (this: unknown) {
    if (active) return compute();
    return realGetter.call(this);
  });
  Object.defineProperty(object, property, { ...native, get: guardedGetter });
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
  const realGetter = native.get;
  const guardedGetter = nativeGetter(property, realGetter, function (this: unknown) {
    const actual = realGetter.call(this) as number;
    return active ? transform(actual) : actual;
  });
  Object.defineProperty(object, property, { ...native, get: guardedGetter });
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
function patchDimensions(w: GuardWindow): void {
  for (const prop of ["innerWidth", "outerWidth"] as const) {
    patchTransformedGetter(w, prop, bucketWidth);
  }
  for (const prop of ["innerHeight", "outerHeight"] as const) {
    patchTransformedGetter(w, prop, bucketHeight);
  }
}

function patchScreenDimensions(w: GuardWindow): void {
  if (typeof w.Screen === "undefined") return;
  patchTransformedGetter(w.Screen.prototype, "width", bucketWidth);
  patchTransformedGetter(w.Screen.prototype, "availWidth", bucketWidth);
  patchTransformedGetter(w.Screen.prototype, "height", bucketHeight);
  patchTransformedGetter(w.Screen.prototype, "availHeight", bucketHeight);
}

// Real, disclosed tradeoff (see clampTimestamp's own comment in
// fingerprintNoise.ts): code measuring frame-to-frame deltas via
// performance.now() (animation loops, scroll physics) can see a run of
// zero-length deltas within the same 100ms bucket. The same visible-jank
// tradeoff Firefox's own resistFingerprinting already carries in
// production -- not a new risk class this introduces, but real enough to
// state here rather than only in a research doc.
function patchTiming(w: GuardWindow): void {
  if (typeof w.Performance !== "undefined") {
    const nativeNow = w.Performance.prototype.now;
    w.Performance.prototype.now = nativeMethod<typeof nativeNow>(nativeNow, function guardedNow(this: Performance): number {
      const actual = nativeNow.call(this);
      return active ? clampTimestamp(actual) : actual;
    });
  }

  const nativeDateNow = w.Date.now;
  w.Date.now = nativeMethod<typeof nativeDateNow>(nativeDateNow, function guardedDateNow(): number {
    const actual = nativeDateNow();
    return active ? clampTimestamp(actual) : actual;
  });

  if (typeof w.Event !== "undefined") {
    patchTransformedGetter(w.Event.prototype, "timeStamp", clampTimestamp);
  }
}

function patchWebGL(w: GuardWindow): void {
  const contexts = [
    typeof w.WebGLRenderingContext === "undefined" ? undefined : w.WebGLRenderingContext,
    typeof w.WebGL2RenderingContext === "undefined" ? undefined : w.WebGL2RenderingContext,
  ];
  for (const ctor of contexts) {
    if (!ctor) continue;
    const nativeGetParameter = ctor.prototype.getParameter;
    ctor.prototype.getParameter = nativeMethod<typeof nativeGetParameter>(nativeGetParameter, function guardedGetParameter(
      this: WebGLRenderingContext,
      pname: number
    ): ReturnType<typeof nativeGetParameter> {
      if (active) {
        if (pname === UNMASKED_VENDOR_WEBGL) return SPOOFED_WEBGL_VENDOR;
        if (pname === UNMASKED_RENDERER_WEBGL) return SPOOFED_WEBGL_RENDERER;
      }
      return nativeGetParameter.call(this, pname);
    });
  }
}

function patchNavigatorHints(w: GuardWindow): void {
  const nativeConcurrency = Object.getOwnPropertyDescriptor(w.Navigator.prototype, "hardwareConcurrency");
  const nativeMemory = Object.getOwnPropertyDescriptor(
    w.Navigator.prototype as Navigator & { deviceMemory?: number },
    "deviceMemory"
  );

  if (nativeConcurrency?.get) {
    const guardedGetter = nativeGetter("hardwareConcurrency", nativeConcurrency.get, function (this: Navigator) {
      const actual = nativeConcurrency.get!.call(this) as number;
      return active ? bucketHardwareConcurrency(actual) : actual;
    });
    Object.defineProperty(w.Navigator.prototype, "hardwareConcurrency", {
      ...nativeConcurrency,
      get: guardedGetter,
    });
  }

  if (nativeMemory?.get) {
    const guardedGetter = nativeGetter("deviceMemory", nativeMemory.get, function (this: Navigator) {
      const actual = nativeMemory.get!.call(this) as number;
      return active ? bucketDeviceMemory(actual) : actual;
    });
    Object.defineProperty(w.Navigator.prototype, "deviceMemory", {
      ...nativeMemory,
      get: guardedGetter,
    });
  }
}

// Patching every one of these prototypes has a real per-call cost (an extra
// function-call indirection, plus a Function.prototype.toString side-table
// registration via nativeMethod/nativeGetter) that every page pays whether or not
// fingerprint resistance is actually on -- and it's off by default, so most
// visitors were paying it for nothing. Deferred to the first config message
// that actually reports the feature on, instead of running unconditionally
// at parse time: `active` already gates *behavior* inside the patched
// functions, this just also gates whether they get patched at all.
const patchedWindows = new WeakSet<Window>();

/** Same-origin frames the page makes itself (about:blank, srcdoc, blob:)
 * have their own HTMLCanvasElement, Navigator and the rest, and a page read
 * the real canvas through them. Chrome runs this file in about:blank and
 * blob: frames too, but its config arrives a moment later, after the page
 * may already have read. So the moment the page reaches into a same-origin
 * frame, this page's guard patches it, with this page's seed. */
function patchFramesOnAccess(w: GuardWindow): void {
  for (const ctor of [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement]) {
    for (const property of ["contentWindow", "contentDocument"] as const) {
      const native = Object.getOwnPropertyDescriptor(ctor.prototype, property);
      if (!native?.get) continue;
      const realGetter = native.get;
      Object.defineProperty(ctor.prototype, property, {
        ...native,
        get: nativeGetter(property, realGetter, function (this: Element) {
          const value = realGetter.call(this) as Window | Document | null;
          // Not instanceof Document: the frame's Document is its own realm's.
          const child = property === "contentDocument" ? ((value as Document | null)?.defaultView ?? null) : (value as Window | null);
          if (active && child && child !== w) {
            try {
              void child.document; // throws for a cross-origin frame
              ensurePatched(child as GuardWindow);
            } catch {
              // Cross-origin: its own copy of this script guards it.
            }
          }
          return value;
        }),
      });
    }
  }
}

function ensurePatched(w: GuardWindow = window): void {
  if (patchedWindows.has(w)) return;
  patchedWindows.add(w);
  if (w !== window) maskRealm(w);
  // Each surface is independent -- one throwing (an unusual embedding
  // context missing a global this file assumes) must not stop the others
  // from installing. Previously these ran unconditionally at parse time
  // with the same lack of isolation between them; grouping them here is
  // what makes that pre-existing gap worth closing now.
  for (const patch of [patchCanvas, patchOffscreenCanvas, patchBlobUrls, patchWorkers, patchAudio, patchWebGL, patchNavigatorHints, patchDimensions, patchScreenDimensions, patchTiming, patchFramesOnAccess]) {
    try {
      patch(w);
    } catch {
      // Best-effort: losing noise on one surface is better than losing it
      // on every surface over one missing global.
    }
  }
}

function applyConfig(data: FingerprintGuardConfig | undefined): void {
  if (typeof data?.fingerprintResistance !== "boolean" || typeof data.fingerprintSeed !== "string") return;
  active = data.fingerprintResistance;
  seed = data.fingerprintSeed;
  blobWorkers = data.blobWorkers === true;
  // Patch as soon as the feature is ever turned on for this page load --
  // covers both "already on at load" and "the user flips it on mid-session"
  // (bridge.ts re-sends config on a storage change). Once patched, later
  // messages just keep updating `active`/`seed` above; a later "off"
  // message correctly leaves the (now-dormant) patches in place rather than
  // trying to unpatch, same as before this change.
  if (active) ensurePatched();
}

document.addEventListener(GUARD_CONNECT_EVENT, (event) => {
  const port = (event as MessageEvent).ports?.[1];
  if (bridgePort || !port) return;
  bridgePort = port;
  port.onmessage = (message: MessageEvent<FingerprintGuardConfig>) => applyConfig(message.data);
});

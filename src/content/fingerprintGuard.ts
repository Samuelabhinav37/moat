// Runs in the page's MAIN world at document_start, like mainWorldGuard.ts,
// but is a separate script: this is the one opt-in, occasionally-risky
// feature in the extension (it can change what a page observes, e.g. a
// canvas CAPTCHA), so it's kept independently toggleable and easy to
// reason about on its own.
//
// Inactive (does nothing) until a "config" message from bridge.ts reports
// fingerprintResistance: true -- which only happens when the user has
// opted in via Settings and the site isn't paused.
import {
  bucketDeviceMemory,
  bucketHardwareConcurrency,
  noisifyFloatSamples,
  noisifyRGBA,
  SPOOFED_WEBGL_RENDERER,
  SPOOFED_WEBGL_VENDOR,
  UNMASKED_RENDERER_WEBGL,
  UNMASKED_VENDOR_WEBGL,
} from "./fingerprintNoise";
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
}

function patchAudio(): void {
  if (typeof AudioBuffer === "undefined") return;
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
  }
}

function patchNavigatorHints(): void {
  const nativeConcurrency = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency");
  const nativeMemory = Object.getOwnPropertyDescriptor(
    Navigator.prototype as Navigator & { deviceMemory?: number },
    "deviceMemory"
  );

  if (nativeConcurrency?.get) {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
      ...nativeConcurrency,
      get(this: Navigator) {
        const actual = nativeConcurrency.get!.call(this) as number;
        return active ? bucketHardwareConcurrency(actual) : actual;
      },
    });
  }

  if (nativeMemory?.get) {
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      ...nativeMemory,
      get(this: Navigator) {
        const actual = nativeMemory.get!.call(this) as number;
        return active ? bucketDeviceMemory(actual) : actual;
      },
    });
  }
}

patchCanvas();
patchAudio();
patchWebGL();
patchNavigatorHints();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as BridgeMessage | undefined;
  if (!data || data.source !== "moat" || data.type !== "config") return;
  if (lockedGuardToken === null) lockedGuardToken = data.guardToken;
  if (data.guardToken !== lockedGuardToken) return;
  active = data.fingerprintResistance;
  seed = data.fingerprintSeed;
});

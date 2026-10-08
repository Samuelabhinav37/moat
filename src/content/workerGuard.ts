// The fingerprint guard inside a dedicated worker the page starts.
//
// Content scripts never run in workers, so a page could draw on an
// OffscreenCanvas in a worker and read real pixels there. When fingerprint
// resistance is on, fingerprintGuard.ts's patchWorkers starts each page
// worker from a blob: bootstrap instead: this function, then the page's own
// script (importScripts for a classic worker, import() for a module one).
//
// This function is shipped as source text (Function.prototype.toString), so
// it must stay self-contained: no imports, nothing from outside its body.
// The noise math is a copy of fingerprintNoise.ts's, and
// workerGuard.test.ts checks the two give the same bytes, so a page that
// hashes one drawing in the page and in a worker gets one answer.
//
// The worker's real address is the bootstrap's blob: URL. self.location and
// relative URLs (importScripts, fetch, XMLHttpRequest, nested workers...)
// are pointed back at the page's script address, so the script sees what it
// would have seen.

/** `seed`: the page's fingerprint seed. `scriptUrl`: the address the page
 * asked for. `preludeSource`: this function's own source, for nested
 * workers. */
export function workerGuardPrelude(seed: string, scriptUrl: string, preludeSource: string): void {
  type AnyFn = (...args: any[]) => any;
  type Ctor = new (...args: any[]) => any;
  const g = globalThis as any;

  // --- built-in look-alikes (see nativeToString.ts) ---------------------
  const fnProto = g.Function.prototype;
  const nativeToString: AnyFn = fnProto.toString;
  const spoofed = new WeakMap<object, string>();
  const patchedToString = {
    toString(this: object): string {
      return spoofed.get(this) ?? nativeToString.call(this);
    },
  }.toString;
  fnProto.toString = patchedToString;
  spoofed.set(patchedToString, nativeToString.call(nativeToString));

  function ownerOf(object: any, name: string): any {
    for (let o = object; o; o = Object.getPrototypeOf(o)) {
      if (Object.prototype.hasOwnProperty.call(o, name)) return o;
    }
    return null;
  }

  function patchMethod(owner: any, name: string, impl: (this: any, original: AnyFn, args: any[]) => unknown): void {
    if (!owner) return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    const original = descriptor?.value as AnyFn | undefined;
    if (typeof original !== "function") return;
    const fn = {
      [name](this: unknown, ...args: unknown[]): unknown {
        return impl.call(this, original, args);
      },
    }[name]!;
    Object.defineProperty(fn, "length", { value: original.length });
    spoofed.set(fn, nativeToString.call(original));
    Object.defineProperty(owner, name, { ...descriptor, value: fn });
  }

  function patchGetter(owner: any, name: string, impl: (this: any, real: AnyFn) => unknown): void {
    if (!owner) return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    const real = descriptor?.get;
    if (!real) return;
    const fn = Object.getOwnPropertyDescriptor(
      {
        get [name]() {
          return impl.call(this, real);
        },
      },
      name
    )!.get!;
    spoofed.set(fn, nativeToString.call(real));
    Object.defineProperty(owner, name, { ...descriptor, get: fn });
  }

  function patchConstructor(name: string, mapArgs: (args: any[]) => any[]): void {
    const owner = ownerOf(g, name);
    const Native = owner?.[name] as Ctor | undefined;
    if (typeof Native !== "function") return;
    const proxy = new Proxy(Native, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, mapArgs(args), newTarget);
      },
    });
    spoofed.set(proxy, nativeToString.call(Native));
    Object.defineProperty(owner, name, { ...Object.getOwnPropertyDescriptor(owner, name), value: proxy });
    const constructorProp = Object.getOwnPropertyDescriptor(Native.prototype, "constructor");
    if (constructorProp) Object.defineProperty(Native.prototype, "constructor", { ...constructorProp, value: proxy });
  }

  // --- the noise (copied from fingerprintNoise.ts) ------------------------
  function hashString(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
    return hash >>> 0;
  }
  function mulberry32(start: number): () => number {
    let state = start | 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function noisifyRGBA(data: Uint8ClampedArray, seedString: string): void {
    const rand = mulberry32(hashString(seedString));
    for (let i = 0; i < data.length; i += 4) {
      const delta = Math.floor(rand() * 3) - 1;
      data[i] = (data[i] ?? 0) + delta;
      data[i + 1] = (data[i + 1] ?? 0) + delta;
      data[i + 2] = (data[i + 2] ?? 0) + delta;
    }
  }
  const nearest = (value: number, buckets: number[]): number =>
    buckets.reduce((best, b) => (Math.abs(b - value) < Math.abs(best - value) ? b : best));
  const clampTimestamp = (ms: number): number => Math.floor(ms / 100) * 100;
  const canvasSeed = (width: number, height: number): string => `${seed}:canvas:${width}x${height}`;

  // --- canvas -------------------------------------------------------------
  const Offscreen = g.OffscreenCanvas as Ctor | undefined;
  const ctx2dProto = g.OffscreenCanvasRenderingContext2D?.prototype;
  const nativeGetImageData = ctx2dProto?.getImageData as AnyFn | undefined;
  if (Offscreen && nativeGetImageData) {
    patchMethod(ctx2dProto, "getImageData", function (this: any, original, args) {
      const imageData = original.apply(this, args);
      noisifyRGBA(imageData.data, canvasSeed(this.canvas.width, this.canvas.height));
      return imageData;
    });
    patchMethod(Offscreen.prototype, "convertToBlob", function (this: any, original, args) {
      const { width, height } = this;
      const clone = new Offscreen(width, height);
      const ctx = width > 0 && height > 0 ? clone.getContext("2d") : null;
      if (!ctx) return original.apply(this, args);
      ctx.drawImage(this, 0, 0);
      const imageData = nativeGetImageData.call(ctx, 0, 0, width, height);
      noisifyRGBA(imageData.data, canvasSeed(width, height));
      ctx.putImageData(imageData, 0, 0);
      return original.apply(clone, args);
    });
  }

  for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
    patchMethod(g[name]?.prototype, "getParameter", function (this: any, original, args) {
      if (args[0] === 0x9245) return "Google Inc. (Generic)";
      if (args[0] === 0x9246) return "ANGLE (Generic, Generic Direct3D11 vs_5_0 ps_5_0, D3D11)";
      return original.apply(this, args);
    });
  }

  // --- navigator and clocks -----------------------------------------------
  const navProto = g.WorkerNavigator?.prototype;
  patchGetter(navProto, "hardwareConcurrency", function (this: any, real) {
    return nearest(real.call(this), [2, 4, 8, 16, 32]);
  });
  patchGetter(navProto, "deviceMemory", function (this: any, real) {
    return nearest(real.call(this), [2, 4, 8]);
  });
  patchMethod(g.Performance?.prototype, "now", function (this: any, original, args) {
    return clampTimestamp(original.apply(this, args));
  });
  patchMethod(g.Date, "now", function (this: any, original, args) {
    return clampTimestamp(original.apply(this, args));
  });
  patchGetter(g.Event?.prototype, "timeStamp", function (this: any, real) {
    return clampTimestamp(real.call(this));
  });

  // --- the script's own address -------------------------------------------
  const address = new URL(scriptUrl);
  const locationProto = g.WorkerLocation?.prototype;
  for (const key of ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"] as const) {
    patchGetter(locationProto, key, () => address[key]);
  }
  patchMethod(locationProto, "toString", () => address.href);

  const absolute = /^[a-z][a-z0-9+.-]*:/i;
  const resolve = (url: unknown): unknown => {
    if (typeof url !== "string" || absolute.test(url)) return url;
    try {
      return new URL(url, scriptUrl).href;
    } catch {
      return url;
    }
  };
  const resolveFirst = (args: any[]): any[] => (args.length ? [resolve(args[0]), ...args.slice(1)] : args);

  patchMethod(ownerOf(g, "importScripts"), "importScripts", function (this: any, original, args) {
    return original.apply(this, args.map(resolve));
  });
  patchMethod(ownerOf(g, "fetch"), "fetch", function (this: any, original, args) {
    return original.apply(this, resolveFirst(args));
  });
  patchMethod(g.XMLHttpRequest?.prototype, "open", function (this: any, original, args) {
    if (args.length > 1) args[1] = resolve(args[1]);
    return original.apply(this, args);
  });
  for (const name of ["Request", "WebSocket", "EventSource"]) patchConstructor(name, resolveFirst);

  // A worker this worker starts gets the same treatment.
  const NativeBlob = g.Blob as Ctor;
  const createObjectURL = g.URL.createObjectURL as AnyFn;
  const revokeObjectURL = g.URL.revokeObjectURL as AnyFn;
  patchConstructor("Worker", (args) => {
    const url = resolve(args[0]);
    const options = args[1];
    if (typeof url !== "string" || !/^https?:/.test(url) || new URL(url).origin !== address.origin) return args;
    if (options !== undefined && (typeof options !== "object" || options === null)) return args;
    const module = options?.type === "module";
    if (module && options.credentials !== undefined && options.credentials !== "same-origin") return args;
    // Same bootstrap shapes as fingerprintGuard.ts's guardedWorkerArgs.
    const json = JSON.stringify;
    const blobUrl = (text: string): string => createObjectURL(new NativeBlob([text], { type: "text/javascript" }));
    const prelude = `(${preludeSource})(${json(seed)},${json(url)},${json(preludeSource)});`;
    let source = `${prelude}\nimportScripts(${json(url)});`;
    if (module) {
      const preludeUrl = blobUrl(`URL.revokeObjectURL(import.meta.url);${prelude}`);
      setTimeout(() => revokeObjectURL(preludeUrl), 30_000);
      source = `import ${json(preludeUrl)};\nimport ${json(url)};`;
    }
    const bootstrap = blobUrl(source);
    setTimeout(() => revokeObjectURL(bootstrap), 0);
    return [bootstrap, ...args.slice(1)];
  });
}

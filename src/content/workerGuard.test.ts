import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { noisifyRGBA } from "./fingerprintNoise";
import { workerGuardPrelude } from "./workerGuard";

// Runs the prelude the way a worker does (as source text, in a fresh realm)
// against stand-ins for the worker globals it patches.
const SETUP = `
  globalThis.OffscreenCanvasRenderingContext2D = class OffscreenCanvasRenderingContext2D {
    constructor(canvas) { this.canvas = canvas; }
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
      return { data };
    }
  }
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return new OffscreenCanvasRenderingContext2D(this); }
  }
  globalThis.WorkerLocation = class WorkerLocation {
    get href() { return "blob:https://site.example/bootstrap"; }
    get pathname() { return "https://site.example/bootstrap"; }
    toString() { return this.href; }
  }
  var location = new WorkerLocation();
  var calls = [];
  var importScripts = function importScripts(...urls) { calls.push(["importScripts", ...urls]); };
  var fetch = function fetch(input) { calls.push(["fetch", input]); };
`;

function runPrelude(seed: string, scriptUrl: string): Record<string, any> {
  const context = createContext({ URL, Uint8ClampedArray, Proxy, Reflect, WeakMap, JSON, Math });
  runInContext(SETUP, context);
  const source = workerGuardPrelude.toString();
  runInContext(`(${source})(${JSON.stringify(seed)}, ${JSON.stringify(scriptUrl)}, ${JSON.stringify(source)})`, context);
  return context;
}

describe("workerGuardPrelude", () => {
  it("noises worker canvas reads exactly as the page's guard does", () => {
    const worker = runPrelude("seed@site.example", "https://site.example/js/w.js");
    const read = runInContext("new OffscreenCanvas(20, 10).getContext('2d').getImageData(0, 0, 20, 10).data", worker);

    const expected = new Uint8ClampedArray(20 * 10 * 4);
    for (let i = 0; i < expected.length; i++) expected[i] = (i * 37) % 256;
    const clean = expected.slice();
    noisifyRGBA(expected, "seed@site.example:canvas:20x10");

    expect([...read]).toEqual([...expected]);
    expect([...read]).not.toEqual([...clean]);
  });

  it("reports the page script's address, not the bootstrap's", () => {
    const worker = runPrelude("s", "https://site.example/js/w.js?v=2");
    expect(runInContext("location.href", worker)).toBe("https://site.example/js/w.js?v=2");
    expect(runInContext("location.pathname", worker)).toBe("/js/w.js");
    expect(runInContext("String(location)", worker)).toBe("https://site.example/js/w.js?v=2");
  });

  it("resolves relative URLs against the page script's address", () => {
    const worker = runPrelude("s", "https://site.example/js/w.js");
    runInContext("importScripts('lib.js', '/root.js', 'https://cdn.example/x.js'); fetch('data/a.wasm')", worker);
    expect(runInContext("JSON.stringify(calls)", worker)).toBe(
      JSON.stringify([
        ["importScripts", "https://site.example/js/lib.js", "https://site.example/root.js", "https://cdn.example/x.js"],
        ["fetch", "https://site.example/js/data/a.wasm"],
      ])
    );
  });

  it("keeps patched functions looking built-in", () => {
    const worker = runPrelude("s", "https://site.example/w.js");
    const getImageData = runInContext("Function.prototype.toString.call(OffscreenCanvasRenderingContext2D.prototype.getImageData)", worker);
    expect(getImageData).toContain("getImageData(x, y, w, h)");
    expect(runInContext("importScripts.name + importScripts.length", worker)).toBe("importScripts0");
  });
});

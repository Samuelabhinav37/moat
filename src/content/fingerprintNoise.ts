// Pure math behind the opt-in fingerprint-resistance guard
// (fingerprintGuard.ts). Kept separate from the actual DOM/Canvas/WebGL
// patching so it's testable without a real browser -- jsdom doesn't
// implement canvas rendering.
//
// The noise is deterministic per (install seed, seed string) so the same
// canvas/audio content on the same installation always reads back the same
// noised values -- a site re-reading it twice shouldn't see it change,
// which would itself be a distinguishing signal. Different installations
// get different noise, which is what actually defeats cross-site/cross-
// visit correlation.

/** Small, fast, deterministic PRNG (mulberry32). Same seed -> same sequence. */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit string hash (djb2-ish), used to turn a seed string into mulberry32's numeric seed. */
export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Perturbs RGB channels (not alpha) by -1, 0, or +1 in place, deterministic
 * per seedString. Uint8ClampedArray clamps automatically, so no manual
 * bounds checking is needed.
 */
export function noisifyRGBA(data: Uint8ClampedArray, seedString: string): void {
  const rand = mulberry32(hashString(seedString));
  for (let i = 0; i < data.length; i += 4) {
    const delta = Math.floor(rand() * 3) - 1;
    data[i] = (data[i] ?? 0) + delta;
    data[i + 1] = (data[i + 1] ?? 0) + delta;
    data[i + 2] = (data[i + 2] ?? 0) + delta;
  }
}

/** Same idea for AudioBuffer channel data: a tiny (inaudible) deterministic offset per sample. */
export function noisifyFloatSamples(data: Float32Array, seedString: string): void {
  const rand = mulberry32(hashString(seedString));
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (data[i] ?? 0) + (rand() - 0.5) * 0.0001;
  }
}

/** Rounds a value to the nearest of a small set of common values, to reduce how much it narrows down a device. */
function nearestBucket(value: number, buckets: number[]): number {
  return buckets.reduce((best, bucket) => (Math.abs(bucket - value) < Math.abs(best - value) ? bucket : best));
}

export function bucketHardwareConcurrency(actual: number): number {
  return nearestBucket(actual, [2, 4, 8, 16, 32]);
}

export function bucketDeviceMemory(actual: number): number {
  return nearestBucket(actual, [2, 4, 8]);
}

export const SPOOFED_WEBGL_VENDOR = "Google Inc. (Generic)";
export const SPOOFED_WEBGL_RENDERER = "ANGLE (Generic, Generic Direct3D11 vs_5_0 ps_5_0, D3D11)";
// From the WEBGL_debug_renderer_info extension -- the two parameters real
// fingerprinting scripts actually query for GPU info.
export const UNMASKED_VENDOR_WEBGL = 0x9245;
export const UNMASKED_RENDERER_WEBGL = 0x9246;

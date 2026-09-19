// Pure math behind the opt-in fingerprint-resistance guard
// (fingerprintGuard.ts). Kept separate from the actual DOM/Canvas/WebGL
// patching so it's testable without a real browser -- jsdom doesn't
// implement canvas rendering.
//
// The noise is deterministic per (seed, seed string) so the same
// canvas/audio content on the same page reads back the same noised values
// within one visit -- a site re-reading it twice shouldn't see it change,
// which would itself be a distinguishing signal. This module has no opinion
// about where `seed` itself comes from or what it's scoped to -- that's
// background/settings.ts's scopeFingerprintSeedToSite(), which folds in the
// top-level site's hostname (and, by default, the current browser session)
// before the seed ever reaches here via bridge.ts. That's what actually
// defeats cross-site and cross-session correlation: two different sites,
// or the same site after a restart, get different noise from this same
// deterministic math.

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

// Tor Browser's own letterboxing bucket size (200x100, read as width x
// height -- the conventional resolution-notation order, matching how the
// Tor Browser design doc itself writes it), capped at 1000px per side --
// see docs/research/tor-browser-anti-tracking-techniques-2026-09.md §1.
// Deliberately a deterministic floor of the REAL value, not per-seed noise
// like noisifyRGBA/noisifyFloatSamples above: the defense here is entropy
// reduction (many real sizes collapse to one reported bucket), not
// per-install diversity, so no seed is involved -- and unlike a random
// per-seed offset, a stable floor never makes two reads of the same
// dimension within one page load disagree with each other, which would
// itself be a distinguishing signal.
//
// Worth stating plainly: the 1000px cap means almost every real, non-Tor
// browser window (most monitors exceed 1000px in both dimensions) reports
// the same capped value rather than a genuinely granular bucket. That's not
// a bug -- for Tor Browser, whose own UX discourages maximizing so its
// windows mostly stay under the cap already, the cap is rarely the active
// mechanism; for Moat's ordinary, usually-larger browser windows, the cap
// itself becomes the main defense (most users collapse onto one shared
// value), which is a cruder but still real uniformity win, not a failure
// of the bucketing to do anything.
export function bucketWidth(actual: number): number {
  return Math.min(1000, Math.floor(actual / 200) * 200);
}
export function bucketHeight(actual: number): number {
  return Math.min(1000, Math.floor(actual / 100) * 100);
}

// Mozilla's own resistFingerprinting policy: "Time Precision is reduced to
// 100ms" (see the research doc's §1 citation). A deterministic floor, same
// "no seed, no per-read jitter" reasoning as bucketWidth/bucketHeight above
// -- jittering would make two reads of the same instant within one page
// load disagree, which is worse than a stable rounded value. Real,
// disclosed tradeoff: code that measures frame-to-frame deltas via
// performance.now() (animation loops, scroll physics) can see a run of
// zero-length deltas within the same 100ms bucket -- the same visible-jank
// tradeoff Firefox's own resistFingerprinting already carries in
// production, not a new risk class this introduces.
export function clampTimestamp(ms: number): number {
  return Math.floor(ms / 100) * 100;
}

// Firefox's actual shipped Tor-Uplift defense spoofs AudioContext's own
// outputLatency/sampleRate properties to fixed values, rather than noising
// them like noisifyFloatSamples does for buffer contents -- same
// fixed-constant shape as SPOOFED_WEBGL_VENDOR/SPOOFED_WEBGL_RENDERER above.
// 44100Hz is the overwhelmingly common default sample rate; ~0.01s is a
// small, plausible output latency for a typical consumer audio device.
export const SPOOFED_AUDIO_SAMPLE_RATE = 44100;
export const SPOOFED_AUDIO_OUTPUT_LATENCY = 0.01;

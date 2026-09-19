import { describe, expect, it } from "vitest";
import {
  bucketDeviceMemory,
  bucketHardwareConcurrency,
  bucketHeight,
  bucketWidth,
  clampTimestamp,
  hashString,
  mulberry32,
  noisifyFloatSamples,
  noisifyRGBA,
} from "./fingerprintNoise";

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produces a different sequence for a different seed", () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });

  it("stays within [0, 1)", () => {
    const rand = mulberry32(123);
    for (let i = 0; i < 100; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("example.com")).toBe(hashString("example.com"));
  });

  it("differs for different strings", () => {
    expect(hashString("example.com")).not.toBe(hashString("other.com"));
  });
});

describe("noisifyRGBA", () => {
  it("is deterministic for the same seed and input", () => {
    const a = new Uint8ClampedArray([100, 150, 200, 255, 10, 20, 30, 255]);
    const b = new Uint8ClampedArray(a);
    noisifyRGBA(a, "seed-a");
    noisifyRGBA(b, "seed-a");
    expect(a).toEqual(b);
  });

  it("produces different output for different seeds", () => {
    const a = new Uint8ClampedArray(400).fill(128);
    const b = new Uint8ClampedArray(400).fill(128);
    noisifyRGBA(a, "seed-a");
    noisifyRGBA(b, "seed-b");
    expect(a).not.toEqual(b);
  });

  it("never shifts a channel by more than 1", () => {
    const original = [100, 150, 200, 255];
    const data = new Uint8ClampedArray(original);
    noisifyRGBA(data, "any-seed");
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(data[i]! - original[i]!)).toBeLessThanOrEqual(1);
    }
  });

  it("never touches the alpha channel", () => {
    const data = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 128]);
    noisifyRGBA(data, "seed");
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(128);
  });

  it("clamps at the byte boundaries instead of wrapping", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    // Run many seeds; none should ever produce a value outside [0, 255]
    // (Uint8ClampedArray guarantees this, but assert intent explicitly).
    for (let seed = 0; seed < 50; seed += 1) {
      const copy = new Uint8ClampedArray(data);
      noisifyRGBA(copy, `seed-${seed}`);
      for (const value of copy) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("noisifyFloatSamples", () => {
  it("is deterministic for the same seed", () => {
    const a = new Float32Array([0.1, -0.2, 0.3]);
    const b = new Float32Array(a);
    noisifyFloatSamples(a, "seed");
    noisifyFloatSamples(b, "seed");
    expect(a).toEqual(b);
  });

  it("perturbs by a very small amount", () => {
    const data = new Float32Array([0.5]);
    noisifyFloatSamples(data, "seed");
    expect(Math.abs(data[0]! - 0.5)).toBeLessThan(0.001);
  });
});

describe("bucketHardwareConcurrency", () => {
  it("rounds to the nearest common core count", () => {
    expect(bucketHardwareConcurrency(6)).toBe(4); // closer to 4 than 8
    expect(bucketHardwareConcurrency(7)).toBe(8); // closer to 8 than 4
    expect(bucketHardwareConcurrency(8)).toBe(8);
  });
});

describe("bucketDeviceMemory", () => {
  it("rounds to the nearest common memory size", () => {
    expect(bucketDeviceMemory(3)).toBe(2); // tie between 2 and 4 -> first (2) wins
    expect(bucketDeviceMemory(7)).toBe(8);
  });
});

describe("bucketWidth / bucketHeight", () => {
  it("floors to Tor's own 200x100 bucket size, below the 1000px cap", () => {
    expect(bucketWidth(950)).toBe(800);
    expect(bucketHeight(480)).toBe(400);
  });

  it("is exact on a bucket boundary", () => {
    expect(bucketWidth(800)).toBe(800);
    expect(bucketHeight(400)).toBe(400);
  });

  it("floors just-under and just-over a boundary into the same bucket", () => {
    expect(bucketWidth(799)).toBe(600);
    expect(bucketWidth(800)).toBe(800);
    expect(bucketWidth(801)).toBe(800);
  });

  it("caps at 1000px regardless of how large the real value is -- true for almost every real monitor, not just an edge case", () => {
    expect(bucketWidth(1920)).toBe(1000);
    expect(bucketHeight(1080)).toBe(1000);
    expect(bucketWidth(3840)).toBe(1000);
    expect(bucketHeight(2160)).toBe(1000);
  });

  it("floors small values down to 0 rather than a negative bucket", () => {
    expect(bucketWidth(150)).toBe(0);
    expect(bucketHeight(50)).toBe(0);
  });
});

describe("clampTimestamp", () => {
  it("floors to the nearest 100ms", () => {
    expect(clampTimestamp(1234)).toBe(1200);
    expect(clampTimestamp(1299)).toBe(1200);
    expect(clampTimestamp(1300)).toBe(1300);
  });

  it("is idempotent -- clamping an already-clamped value changes nothing", () => {
    expect(clampTimestamp(clampTimestamp(1234))).toBe(clampTimestamp(1234));
  });
});

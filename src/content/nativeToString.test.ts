import { describe, expect, it } from "vitest";
import { maskAsNative } from "./nativeToString";

describe("maskAsNative", () => {
  it("makes Function.prototype.toString.call(patched) return the original's toString", () => {
    function original(): void {}
    function patched(): void {}
    maskAsNative(patched, original);
    expect(Function.prototype.toString.call(patched)).toBe(original.toString());
  });

  it("also masks patched.toString() directly", () => {
    function original(): void {}
    function patched(): void {}
    maskAsNative(patched, original);
    expect(patched.toString()).toBe(original.toString());
  });

  it("leaves an unrelated, unmasked function's toString untouched", () => {
    function original(): void {}
    function patched(): void {}
    maskAsNative(patched, original);

    function untouched(a: number, b: number): number {
      return a + b;
    }
    expect(untouched.toString()).toContain("a + b");
  });

  it("doesn't cross-contaminate two independently masked functions", () => {
    function originalA(): void {}
    function patchedA(): void {}
    function originalB(): void {}
    function patchedB(): void {}

    maskAsNative(patchedA, originalA);
    maskAsNative(patchedB, originalB);

    expect(Function.prototype.toString.call(patchedA)).toBe(originalA.toString());
    expect(Function.prototype.toString.call(patchedB)).toBe(originalB.toString());
    expect(Function.prototype.toString.call(patchedA)).not.toBe(Function.prototype.toString.call(patchedB));
  });

  it("makes the Function.prototype.toString patch itself report as native", () => {
    function original(): void {}
    function patched(): void {}
    maskAsNative(patched, original);

    // The patch installed on first call must not reveal itself either.
    expect(Function.prototype.toString.toString()).toContain("[native code]");
  });

  it("spoofs a real native function's own toString output correctly", () => {
    const native = Array.prototype.push;
    function patched(): void {}
    maskAsNative(patched, native);
    expect(Function.prototype.toString.call(patched)).toBe(native.toString());
    expect(Function.prototype.toString.call(patched)).toContain("[native code]");
  });
});

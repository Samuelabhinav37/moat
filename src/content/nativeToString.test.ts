import { describe, expect, it } from "vitest";
import { maskAsNative, nativeGetter, nativeMethod } from "./nativeToString";

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

// What bot-detection scripts check on a built-in besides toString.
function looksBuiltIn(fn: Function, name: string): void {
  expect(fn.name).toBe(name);
  expect(Object.prototype.hasOwnProperty.call(fn, "prototype")).toBe(false);
  expect(() => new (fn as unknown as new () => unknown)()).toThrow(TypeError);
  expect(Function.prototype.toString.call(fn)).toContain("[native code]");
}

describe("nativeMethod", () => {
  it("returns a stand-in that looks like the built-in it replaces", () => {
    const native = Array.prototype.indexOf;
    const fn = nativeMethod<typeof native>(native, function (this: unknown[], value: unknown) {
      return native.call(this, value);
    });
    looksBuiltIn(fn, "indexOf");
    expect(fn.length).toBe(native.length);
    expect(Function.prototype.toString.call(fn)).toBe(native.toString());
  });

  it("calls the implementation with the receiver and arguments", () => {
    const native = Array.prototype.includes;
    const fn = nativeMethod<(this: unknown[], v: unknown) => boolean>(native, function (this: unknown[], v: unknown) {
      return this.length === 2 && v === "x";
    });
    expect(fn.call(["a", "b"], "x")).toBe(true);
  });
});

describe("nativeGetter", () => {
  it("is named like a built-in accessor and masks as the original", () => {
    const original = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
    const getter = nativeGetter("size", original, function (this: Map<unknown, unknown>) {
      return 7;
    });
    looksBuiltIn(getter, "get size");
    expect(Function.prototype.toString.call(getter)).toBe(original.toString());
    expect(getter.call(new Map())).toBe(7);
  });

  it("masks a getter with no original as native source text", () => {
    const getter = nativeGetter("globalPrivacyControl", undefined, () => true);
    expect(Function.prototype.toString.call(getter)).toBe("function get globalPrivacyControl() { [native code] }");
  });
});

describe("the Function.prototype.toString patch", () => {
  it("looks like the built-in toString", () => {
    maskAsNative(function patched() {}, function original() {});
    looksBuiltIn(Function.prototype.toString, "toString");
    expect(Function.prototype.toString.length).toBe(0);
  });
});

// Makes a patched native function/getter indistinguishable from the real
// thing under a `Function.prototype.toString` check -- the standard way
// fraud/bot-detection vendors verify a native API hasn't been tampered
// with. A per-function own `toString` override (`fn.toString = () => ...`)
// is NOT enough: `Function.prototype.toString.call(fn)` ignores an own
// property and runs the built-in algorithm on the function object
// directly, which still reveals the real source. This patches
// Function.prototype.toString itself instead, consulting a side table for
// functions we've deliberately masked and falling through to the real
// implementation for everything else -- the same technique documented in
// browser-fingerprinting/anti-detect literature.
const spoofed = new WeakMap<Function, string>();
let installed = false;

function installGlobalPatch(): void {
  if (installed) return;
  installed = true;
  const nativeToString = Function.prototype.toString;

  // Method shorthand, not a function declaration: like the real one it is
  // named "toString", has no own `prototype` and throws under `new`.
  // Bot-detection scripts check exactly those; a declared function failed
  // all three (name "t" after minifying, prototype present, constructible).
  const patchedToString = {
    toString(this: Function): string {
      return spoofed.get(this) ?? nativeToString.call(this);
    },
  }.toString;

  Function.prototype.toString = patchedToString;
  // The patch function itself must also look native, or checking
  // Function.prototype.toString.toString() gives the whole thing away.
  spoofed.set(patchedToString, nativeToString.call(nativeToString));
}

const maskedRealms = new WeakSet<object>();

/** Points another same-origin frame's Function.prototype.toString at the
 * same table, so functions this script installs into that frame (see
 * mainWorldGuard.ts and fingerprintGuard.ts) read as built-ins there too. */
export function maskRealm(w: Window): void {
  installGlobalPatch();
  try {
    const realm = w as Window & { Function: FunctionConstructor };
    const proto = realm.Function.prototype;
    if (maskedRealms.has(proto) || proto === Function.prototype) return;
    maskedRealms.add(proto);
    const realmToString = proto.toString;
    const patched = {
      toString(this: Function): string {
        return spoofed.get(this) ?? realmToString.call(this);
      },
    }.toString;
    proto.toString = patched;
    spoofed.set(patched, realmToString.call(realmToString));
  } catch {
    // A cross-origin or closing frame: nothing to mask.
  }
}

/**
 * Registers `patchedFn` so that `Function.prototype.toString.call(patchedFn)`
 * (and `patchedFn.toString()`) returns exactly what `originalFn.toString()`
 * returned before it was replaced.
 */
export function maskAsNative(patchedFn: Function, originalFn: Function | string): void {
  installGlobalPatch();
  spoofed.set(patchedFn, typeof originalFn === "string" ? originalFn : originalFn.toString());
}

/**
 * A stand-in for the built-in method `original` that runs `impl` and also
 * passes the cheap checks bot-detection and CAPTCHA scripts run on built-ins
 * besides toString: same `name` and `length`, no own `prototype`, and
 * `new` throws. Method-shorthand functions have those last two properties,
 * as built-ins do; `function` expressions don't. A page that can tell a
 * built-in was swapped scores the visitor as a likely bot and makes the
 * CAPTCHA harder.
 */
export function nativeMethod<T extends Function>(original: Function, impl: (this: any, ...args: any[]) => unknown): T {
  const name = original.name;
  const fn = {
    [name](this: unknown, ...args: unknown[]): unknown {
      return impl.apply(this, args);
    },
  }[name]!;
  Object.defineProperty(fn, "length", { value: original.length });
  maskAsNative(fn, original);
  return fn as unknown as T;
}

/** Getter version of nativeMethod: named "get <property>" like a built-in
 * accessor, no prototype, not constructible, toString masked as
 * `original` (or, for a property the browser doesn't have, as the source
 * text a built-in getter of that name would show). */
export function nativeGetter(property: string, original: Function | undefined, impl: (this: any) => unknown): () => unknown {
  const getter = Object.getOwnPropertyDescriptor(
    {
      get [property]() {
        return impl.call(this);
      },
    },
    property
  )!.get!;
  maskAsNative(getter, original ?? `function get ${property}() { [native code] }`);
  return getter;
}

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

  function patchedToString(this: Function): string {
    return spoofed.get(this) ?? nativeToString.call(this);
  }

  Function.prototype.toString = patchedToString;
  // The patch function itself must also look native, or checking
  // Function.prototype.toString.toString() gives the whole thing away.
  spoofed.set(patchedToString, nativeToString.call(nativeToString));
}

/**
 * Registers `patchedFn` so that `Function.prototype.toString.call(patchedFn)`
 * (and `patchedFn.toString()`) returns exactly what `originalFn.toString()`
 * returned before it was replaced.
 */
export function maskAsNative(patchedFn: Function, originalFn: Function): void {
  installGlobalPatch();
  spoofed.set(patchedFn, originalFn.toString());
}

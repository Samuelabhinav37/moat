import { afterEach, describe, expect, it, vi } from "vitest";
import { randomToken } from "./randomToken";

afterEach(() => vi.unstubAllGlobals());

describe("randomToken", () => {
  it("is 32 hex characters and differs every call", () => {
    const a = randomToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken()).not.toBe(a);
  });

  it("works where crypto.randomUUID doesn't exist (a plain-http page)", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    expect(randomToken()).toMatch(/^[0-9a-f]{32}$/);
  });
});

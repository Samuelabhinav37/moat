import { describe, expect, it } from "vitest";
import { cspAllowsBlobWorkers } from "./cspBlobWorkers";

describe("cspAllowsBlobWorkers", () => {
  it("allows when there's no policy or no directive that covers workers", () => {
    expect(cspAllowsBlobWorkers([])).toBe(true);
    expect(cspAllowsBlobWorkers(["img-src 'self'; frame-ancestors 'none'"])).toBe(true);
  });

  it("follows the worker-src, child-src, script-src, default-src fallback", () => {
    expect(cspAllowsBlobWorkers(["default-src 'self'"])).toBe(false);
    expect(cspAllowsBlobWorkers(["default-src 'self' blob:"])).toBe(true);
    expect(cspAllowsBlobWorkers(["default-src 'self' blob:; script-src 'self'"])).toBe(false);
    expect(cspAllowsBlobWorkers(["script-src 'self'; child-src blob:"])).toBe(true);
    expect(cspAllowsBlobWorkers(["script-src blob:; worker-src 'self'"])).toBe(false);
    expect(cspAllowsBlobWorkers(["worker-src 'self' BLOB:"])).toBe(true);
  });

  it("doesn't count * or 'strict-dynamic' as allowing blob:", () => {
    expect(cspAllowsBlobWorkers(["worker-src *"])).toBe(false);
    expect(cspAllowsBlobWorkers(["script-src 'nonce-abc' 'strict-dynamic' blob:"])).toBe(false);
    expect(cspAllowsBlobWorkers(["worker-src 'none'"])).toBe(false);
  });

  it("needs every policy to allow it, including comma-joined ones", () => {
    expect(cspAllowsBlobWorkers(["worker-src blob:", "default-src 'self'"])).toBe(false);
    expect(cspAllowsBlobWorkers(["worker-src blob:, script-src 'self'"])).toBe(false);
    expect(cspAllowsBlobWorkers(["worker-src blob:, img-src 'self'"])).toBe(true);
  });

  it("uses the first of a repeated directive", () => {
    expect(cspAllowsBlobWorkers(["worker-src blob:; worker-src 'self'"])).toBe(true);
  });
});

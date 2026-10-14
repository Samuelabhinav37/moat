import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "./loopback";

describe("isLoopbackHost", () => {
  it("knows this computer's addresses", () => {
    for (const host of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it("leaves everything else alone", () => {
    for (const host of ["example.com", "localhost.example.com", "notlocalhost", "128.0.0.1", "10.0.0.1", "192.168.1.1", "1270.0.0.1", ""]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

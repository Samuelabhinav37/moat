import { describe, expect, it } from "vitest";
import { isSuffixInRangeResponse, sha1Hex, splitHashForRangeQuery } from "./hibp";

describe("sha1Hex", () => {
  it("matches a known SHA-1 digest", async () => {
    // Well-known test vector: SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    expect(await sha1Hex("password")).toBe("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
  });

  it("produces a 40-character uppercase hex string", async () => {
    const hash = await sha1Hex("anything");
    expect(hash).toMatch(/^[0-9A-F]{40}$/);
  });
});

describe("splitHashForRangeQuery", () => {
  it("splits into a 5-char prefix and 35-char suffix", () => {
    const { prefix, suffix } = splitHashForRangeQuery("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
    expect(prefix).toBe("5BAA6");
    expect(suffix).toBe("1E4C9B93F3F0682250B6CF8331B7EE68FD8");
    expect(prefix.length).toBe(5);
    expect(suffix.length).toBe(35);
  });
});

describe("isSuffixInRangeResponse", () => {
  const body = "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD7:9545824\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:2";

  it("finds a matching suffix regardless of the trailing count", () => {
    expect(isSuffixInRangeResponse(body, "1E4C9B93F3F0682250B6CF8331B7EE68FD7")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSuffixInRangeResponse(body, "1e4c9b93f3f0682250b6cf8331b7ee68fd7")).toBe(true);
  });

  it("tolerates CRLF line endings", () => {
    expect(isSuffixInRangeResponse(body, "0018A45C4D1DEF81644B54AB7F969B88D65")).toBe(true);
  });

  it("returns false when the suffix isn't present", () => {
    expect(isSuffixInRangeResponse(body, "0000000000000000000000000000000000")).toBe(false);
  });
});

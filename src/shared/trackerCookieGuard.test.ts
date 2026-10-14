import { describe, expect, it } from "vitest";
import { isSameCompany, shadowCookieString } from "./trackerCookieGuard";

const groups = [["google.com", "youtube.com"]];

describe("isSameCompany", () => {
  it("guards a tracker's frame on someone else's site", () => {
    expect(isSameCompany("www.youtube.com", "news.example.org", groups)).toBe(false);
    expect(isSameCompany("cdn.example.net", "shop.example.org", groups)).toBe(false);
  });

  it("leaves the tracker's own site alone", () => {
    expect(isSameCompany("www.youtube.com", "m.youtube.com", groups)).toBe(true);
  });

  it("leaves another site of the same company alone", () => {
    expect(isSameCompany("www.youtube.com", "www.google.com", groups)).toBe(true);
    expect(isSameCompany("www.google.co.uk", "www.youtube.com", [["google.co.uk", "youtube.com"]])).toBe(true);
  });

  it("doesn't join two sites that are only in different groups", () => {
    expect(isSameCompany("youtube.com", "example.org", [["youtube.com", "google.com"], ["example.org", "example.net"]])).toBe(false);
  });
});

describe("shadowCookieString", () => {
  it("reads back the frame's own writes, without their attributes", () => {
    expect(shadowCookieString(["a=1; Path=/; Secure", "b=2"])).toBe("a=1; b=2");
  });

  it("lets a later write replace an earlier one of the same name", () => {
    expect(shadowCookieString(["a=1", "b=2", "a=3"])).toBe("b=2; a=3");
  });

  it("removes a name written with an expiry in the past or no max-age", () => {
    expect(shadowCookieString(["a=1", "b=2", "a=; Max-Age=0"])).toBe("b=2");
    expect(shadowCookieString(["a=1", "a=; expires=Thu, 01 Jan 1970 00:00:00 GMT"])).toBe("");
  });

  it("is empty before any write", () => {
    expect(shadowCookieString([])).toBe("");
  });
});

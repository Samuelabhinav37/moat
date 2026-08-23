import { describe, expect, it } from "vitest";
import { matchesKnownRedirectDomain, safeHostname } from "./redirectDomainMatch";

describe("matchesKnownRedirectDomain", () => {
  const domains = new Set(["adnetwork.com", "popads.net"]);

  it("matches an exact domain", () => {
    expect(matchesKnownRedirectDomain("adnetwork.com", domains)).toBe(true);
  });

  it("matches a subdomain of a known domain", () => {
    expect(matchesKnownRedirectDomain("track.adnetwork.com", domains)).toBe(true);
    expect(matchesKnownRedirectDomain("a.b.c.popads.net", domains)).toBe(true);
  });

  it("does not match an unrelated domain", () => {
    expect(matchesKnownRedirectDomain("example.com", domains)).toBe(false);
  });

  it("does not match a domain that merely shares a suffix string", () => {
    // "notadnetwork.com" must not match "adnetwork.com" -- label-based
    // matching, not a substring check.
    expect(matchesKnownRedirectDomain("notadnetwork.com", domains)).toBe(false);
  });

  it("does not match the bare TLD/eTLD of a known domain", () => {
    expect(matchesKnownRedirectDomain("com", domains)).toBe(false);
  });

  it("handles an empty domain set", () => {
    expect(matchesKnownRedirectDomain("adnetwork.com", new Set())).toBe(false);
  });
});

describe("safeHostname", () => {
  it("extracts the hostname from a valid URL", () => {
    expect(safeHostname("https://example.com/path?x=1")).toBe("example.com");
  });

  it("returns null for an unparseable URL instead of throwing", () => {
    expect(safeHostname("not a url")).toBeNull();
    expect(safeHostname("")).toBeNull();
  });

  it("returns an empty string for about:blank rather than throwing or matching", () => {
    // new URL() parses this fine (it's a valid URL), just with no hostname
    // component -- matchesKnownRedirectDomain("") is still safely false.
    expect(safeHostname("about:blank")).toBe("");
    expect(matchesKnownRedirectDomain("", new Set(["adnetwork.com"]))).toBe(false);
  });
});

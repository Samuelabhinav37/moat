import { describe, expect, it } from "vitest";
import { domainChain, matchesDomainOrSubdomain } from "./domainChain";

describe("domainChain", () => {
  it("returns hostname plus each parent domain, most specific first", () => {
    expect(domainChain("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
  });

  it("excludes the bare TLD", () => {
    expect(domainChain("example.com")).toEqual(["example.com"]);
    expect(domainChain("a.b.example.com")).not.toContain("com");
  });

  it("returns an empty array for a bare TLD or empty string", () => {
    expect(domainChain("com")).toEqual([]);
    expect(domainChain("")).toEqual([]);
  });
});

describe("matchesDomainOrSubdomain", () => {
  it("matches an exact entry", () => {
    expect(matchesDomainOrSubdomain("example.com", ["example.com"])).toBe(true);
  });

  it("matches a subdomain of an entry", () => {
    expect(matchesDomainOrSubdomain("shop.example.com", ["example.com"])).toBe(true);
    expect(matchesDomainOrSubdomain("a.b.example.com", ["example.com"])).toBe(true);
  });

  it("does not match a parent domain of an entry", () => {
    expect(matchesDomainOrSubdomain("example.com", ["shop.example.com"])).toBe(false);
  });

  it("does not match an unrelated domain", () => {
    expect(matchesDomainOrSubdomain("example.org", ["example.com"])).toBe(false);
  });

  it("is false for an empty domain list", () => {
    expect(matchesDomainOrSubdomain("example.com", [])).toBe(false);
  });
});

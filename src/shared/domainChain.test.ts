import { describe, expect, it } from "vitest";
import { domainChain } from "./domainChain";

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

import { describe, expect, it } from "vitest";
import { registrableDomain } from "./publicSuffixList.mjs";

// A small fixed PSL fixture instead of a live fetch -- covers exactly the
// cases the consolidation audit needed verified: an ICANN multi-label ccTLD
// suffix (co.uk) and a "private" shared-hosting suffix (blogspot.com,
// github.io), both of which a naive last-two-labels split gets wrong.
const FIXTURE_PSL = {
  rules: new Set(["com", "co.uk", "uk", "blogspot.com", "github.io", "io"]),
  exceptions: new Set(),
};

describe("registrableDomain", () => {
  it("returns null for a bare ICANN suffix -- not itself a registrable domain", () => {
    expect(registrableDomain("co.uk", FIXTURE_PSL)).toBeNull();
  });

  it("treats example.co.uk as its own registrable domain, not co.uk", () => {
    expect(registrableDomain("example.co.uk", FIXTURE_PSL)).toBe("example.co.uk");
  });

  it("groups a subdomain under its real registrable domain, not the ccTLD suffix", () => {
    expect(registrableDomain("www.example.co.uk", FIXTURE_PSL)).toBe("example.co.uk");
  });

  it("returns null for a bare shared-hosting suffix", () => {
    expect(registrableDomain("blogspot.com", FIXTURE_PSL)).toBeNull();
    expect(registrableDomain("github.io", FIXTURE_PSL)).toBeNull();
  });

  it("treats two different users on the same shared-hosting platform as different registrable domains", () => {
    expect(registrableDomain("alice.blogspot.com", FIXTURE_PSL)).toBe("alice.blogspot.com");
    expect(registrableDomain("bob.blogspot.com", FIXTURE_PSL)).toBe("bob.blogspot.com");
    expect(registrableDomain("alice.blogspot.com", FIXTURE_PSL)).not.toBe(registrableDomain("bob.blogspot.com", FIXTURE_PSL));
  });

  it("groups a sub-subdomain under the same shared-hosting user, not the platform", () => {
    expect(registrableDomain("images.alice.blogspot.com", FIXTURE_PSL)).toBe("alice.blogspot.com");
  });

  it("handles an ordinary domain with no special suffix", () => {
    expect(registrableDomain("track.example.com", FIXTURE_PSL)).toBe("example.com");
    expect(registrableDomain("example.com", FIXTURE_PSL)).toBe("example.com");
  });

  it("respects an exception rule by shortening the matched suffix by one label", () => {
    const pslWithException = {
      rules: new Set(["jp", "kawasaki.jp", "*.kawasaki.jp"]),
      exceptions: new Set(["city.kawasaki.jp"]),
    };
    // Without the exception, *.kawasaki.jp would make "city.kawasaki.jp" the
    // suffix itself (null, not registrable). The exception carves it back
    // out to a normal 2-label suffix, so "kawasaki.jp" is the real one.
    expect(registrableDomain("city.kawasaki.jp", pslWithException)).toBe("city.kawasaki.jp");
  });
});

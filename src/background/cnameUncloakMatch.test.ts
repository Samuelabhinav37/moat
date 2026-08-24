import { describe, expect, it } from "vitest";
import { isCandidateForUncloak, isCnameCloakDestination } from "./cnameUncloakMatch";

describe("isCnameCloakDestination", () => {
  it("matches an exact entry in the destination list", () => {
    expect(isCnameCloakDestination("eulerian.net", new Set(["eulerian.net"]))).toBe(true);
  });

  it("matches a subdomain of an entry in the destination list", () => {
    expect(isCnameCloakDestination("track.eulerian.net", new Set(["eulerian.net"]))).toBe(true);
  });

  it("does not match a domain absent from the list", () => {
    expect(isCnameCloakDestination("example.com", new Set(["eulerian.net"]))).toBe(false);
  });
});

describe("isCandidateForUncloak", () => {
  it("is a candidate when the request hostname shares the page's apex", () => {
    expect(isCandidateForUncloak("trk.example.com", "example.com")).toBe(true);
    expect(isCandidateForUncloak("trk.example.com", "www.example.com")).toBe(true);
  });

  it("is not a candidate when the request hostname is a different domain entirely", () => {
    expect(isCandidateForUncloak("doubleclick.net", "example.com")).toBe(false);
  });

  it("is a candidate for the exact same hostname as the page", () => {
    expect(isCandidateForUncloak("example.com", "example.com")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { isHttpsUrl } from "./httpsUrl";

describe("isHttpsUrl", () => {
  it("accepts a well-formed https URL", () => {
    expect(isHttpsUrl("https://athena.acme.example/events")).toBe(true);
  });

  it("rejects http", () => {
    expect(isHttpsUrl("http://athena.acme.example/events")).toBe(false);
  });

  it("rejects a non-URL string without throwing", () => {
    expect(isHttpsUrl("not a url")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isHttpsUrl("")).toBe(false);
  });
});

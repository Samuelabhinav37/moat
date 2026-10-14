import { describe, expect, it, vi } from "vitest";

vi.mock("./siteDisabled", () => ({ getEffectiveSettingsHere: vi.fn(() => new Promise(() => {})), isDisabled: vi.fn() }));

import { unwrapGoogleLink } from "./googleLinkCleaner";

describe("unwrapGoogleLink", () => {
  it("takes the destination out of Google's wrapper, encoded or not", () => {
    expect(unwrapGoogleLink("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&sa=D&ust=1&usg=x")).toBe("https://example.com/a?b=1");
    expect(unwrapGoogleLink("https://www.google.co.uk/url?sa=t&url=https://example.com/")).toBe("https://example.com/");
  });

  it("unwraps a link wrapped twice", () => {
    const inner = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2F";
    expect(unwrapGoogleLink(`https://www.google.com/url?q=${encodeURIComponent(inner)}`)).toBe("https://example.com/");
  });

  it("leaves everything else alone", () => {
    expect(unwrapGoogleLink("https://www.google.com/search?q=https://example.com")).toBeNull();
    expect(unwrapGoogleLink("https://www.google.com/url?q=running+shoes")).toBeNull();
    expect(unwrapGoogleLink("https://www.google.com/url?q=javascript:alert(1)")).toBeNull();
    expect(unwrapGoogleLink("https://www.google.com/url?q=https://bank.com@evil.example/")).toBeNull();
    expect(unwrapGoogleLink("https://evil.example/url?q=https://example.com")).toBeNull();
  });
});

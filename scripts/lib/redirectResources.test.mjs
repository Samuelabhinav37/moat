import { describe, expect, it } from "vitest";
import { resolveRedirectResource } from "./redirectResources.mjs";

describe("resolveRedirectResource", () => {
  const available = new Set(["nooptext.js", "1x1-transparent.gif"]);

  it("returns the filename when it's in the available set", () => {
    expect(resolveRedirectResource("/web-accessible-resources/redirects/nooptext.js", available)).toBe(
      "nooptext.js"
    );
  });

  it("returns null when the referenced resource isn't shipped", () => {
    expect(resolveRedirectResource("/web-accessible-resources/redirects/unknown.js", available)).toBeNull();
  });

  it("handles a bare filename with no directory prefix", () => {
    expect(resolveRedirectResource("nooptext.js", available)).toBe("nooptext.js");
  });

  it("returns null for a path ending in a slash", () => {
    expect(resolveRedirectResource("/web-accessible-resources/redirects/", available)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveRedirectResource("", available)).toBeNull();
  });
});

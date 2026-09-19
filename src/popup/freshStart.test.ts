import { describe, expect, it } from "vitest";
import { buildFreshStartRemoval } from "./freshStart";

describe("buildFreshStartRemoval", () => {
  it("uses Firefox's bare-hostname filter shape when isFirefox is true", () => {
    const removal = buildFreshStartRemoval("https://example.com/path?x=1", true);
    expect(removal?.filter).toEqual({ hostnames: ["example.com"] });
    expect(removal?.hostname).toBe("example.com");
  });

  it("uses Chrome's full-origin filter shape when isFirefox is false", () => {
    const removal = buildFreshStartRemoval("https://example.com/path?x=1", false);
    expect(removal?.filter).toEqual({ origins: ["https://example.com"] });
    expect(removal?.hostname).toBe("example.com");
  });

  it("preserves a non-default port in Chrome's origin but not in Firefox's hostname", () => {
    const removal = buildFreshStartRemoval("http://localhost:8080/", false);
    expect(removal?.filter).toEqual({ origins: ["http://localhost:8080"] });

    const firefoxRemoval = buildFreshStartRemoval("http://localhost:8080/", true);
    expect(firefoxRemoval?.filter).toEqual({ hostnames: ["localhost"] });
  });

  it("only ever asks to remove cookies/indexedDB/localStorage/serviceWorkers, on either browser", () => {
    const chrome = buildFreshStartRemoval("https://example.com/", false);
    const firefox = buildFreshStartRemoval("https://example.com/", true);
    expect(chrome?.dataToRemove).toEqual({
      cookies: true,
      indexedDB: true,
      localStorage: true,
      serviceWorkers: true,
    });
    expect(firefox?.dataToRemove).toEqual(chrome?.dataToRemove);
  });

  it("returns null for a page with no meaningful site to clear", () => {
    expect(buildFreshStartRemoval(undefined, true)).toBeNull();
    expect(buildFreshStartRemoval("chrome://extensions/", true)).toBeNull();
    expect(buildFreshStartRemoval("about:blank", true)).toBeNull();
    expect(buildFreshStartRemoval("file:///C:/report.html", true)).toBeNull();
    expect(buildFreshStartRemoval("not a url", true)).toBeNull();
  });

  it("never targets Moat's own extension pages", () => {
    expect(buildFreshStartRemoval("moz-extension://abc-123/options.html", true)).toBeNull();
    expect(buildFreshStartRemoval("chrome-extension://abc123/options.html", false)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { siteName } from "./siteName";

describe("siteName", () => {
  it("names a site by its main word, without subdomains or the ending", () => {
    expect(siteName("open.spotify.com")).toBe("Spotify");
    expect(siteName("jack-reacher.fandom.com")).toBe("Fandom");
    expect(siteName("www.google.com")).toBe("Google");
    expect(siteName("news.bbc.co.uk")).toBe("BBC");
    expect(siteName("example.com.au")).toBe("Example");
  });

  it("uses the site's own casing where a capital letter gets it wrong", () => {
    expect(siteName("www.youtube.com")).toBe("YouTube");
    expect(siteName("linkedin.com")).toBe("LinkedIn");
    expect(siteName("store.manutd.com")).toBe("Man Utd");
  });

  it("keeps the owner's name on hosts where every subdomain is its own site", () => {
    expect(siteName("alice.github.io")).toBe("Alice");
    expect(siteName("my-blog.blogspot.com")).toBe("My-blog");
    expect(siteName("github.io")).toBe("Github");
  });

  it("leaves addresses and single names alone", () => {
    expect(siteName("192.168.1.1")).toBe("192.168.1.1");
    expect(siteName("localhost")).toBe("localhost");
  });
});

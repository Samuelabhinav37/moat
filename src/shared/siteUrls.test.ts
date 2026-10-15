import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs build helper without types
import { BASE, ORIGIN } from "../../scripts/site/chrome.mjs";
import { SITE, SITE_URLS, whatsNewUrl } from "./siteUrls";

const root = resolve(import.meta.dirname, "..", "..");

describe("siteUrls", () => {
  it("matches the origin and path the website is built for", () => {
    expect(SITE).toBe(`${ORIGIN}${BASE}`);
  });

  it("links a version to its What's New entry", () => {
    expect(whatsNewUrl("0.11.284")).toBe("https://samuelabhinav.com/moat/whats-new/#v0-11-284");
  });

  it("names only pages the website builds", () => {
    const built = readFileSync(join(root, "scripts", "site-build.mjs"), "utf8");
    for (const url of Object.values(SITE_URLS)) {
      const page = url.slice(SITE.length).replace(/#.*/, "").replace(/\/$/, "");
      if (page) expect(built, url).toContain(`"${page}/index.html"`);
    }
  });

  it("leaves no link to the old website address outside the live channel", () => {
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-n", "samuelabhinav37.github.io/moat", "--", "src", "scripts", ":!*.test.*"], { cwd: root, encoding: "utf8" });
    } catch {
      // git grep exits 1 when nothing matches.
    }
    const hits = out
      .split("\n")
      .filter(Boolean)
      .filter((line) => !/samuelabhinav37\.github\.io\/moat\/live/.test(line))
      // The redirect pages that send the old address to the new one.
      .filter((line) => !line.startsWith("scripts/site-redirects.mjs:"));
    expect(hits).toEqual([]);
  });
});

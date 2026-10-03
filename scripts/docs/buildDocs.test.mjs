import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDocs } from "./buildDocs.mjs";

const root = resolve(import.meta.dirname, "..", "..");
let out = "";
const page = (name) => readFileSync(join(out, name), "utf8");

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "moat-docs-"));
  buildDocs(root, out);
});

describe("document pages", () => {
  it("builds the three pages with the shared header, theme and script, and no inline script", () => {
    for (const name of ["privacy.html", "changelog.html", "licenses.html"]) {
      const html = page(name);
      expect(html, name).toContain('<script src="theme-boot.js"></script>');
      expect(html, name).toContain('<script src="docs.js"></script>');
      expect(html, name).toContain('href="options.html#about"');
      // Extension pages refuse inline script and inline event handlers.
      expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g), name).toBeNull();
      expect(html, name).not.toMatch(/\son[a-z]+="/);
    }
  });

  it("names every connection on the privacy page the way Settings › About does", () => {
    const en = JSON.parse(readFileSync(join(root, "src/_locales/en/messages.json"), "utf8"));
    const html = page("privacy.html");
    for (const key of ["optionsDisclosureUpdatesName", "optionsDisclosureCnameName", "optionsDisclosureBreachName", "optionsDisclosureSyncName", "optionsDisclosureReportsName", "optionsDisclosureOrgName"]) {
      expect(html, key).toContain(en[key].message);
    }
  });

  it("puts the current version on the changelog", () => {
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    expect(page("changelog.html")).toContain(`<span class="ver">${version}</span>`);
  });
});

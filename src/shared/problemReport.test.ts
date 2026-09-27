/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_NOTE_LENGTH, formatReport, reportTitle, validateReport, type ProblemReport } from "./problemReport";
import { summarizeFilterLists, type RulesetManifestEntry } from "./rulesetManifest";

const good: ProblemReport = {
  v: 1,
  category: "broken",
  hostname: "news.example.com",
  note: "The video player stays black.",
  moatVersion: "0.11.163",
  browser: "Chrome 141",
  level: "standard",
  lists: ["AdGuard Base filter", "Community blocklist (oisd)"],
  pausingFixes: "yes",
};

const check = (patch: Record<string, unknown>) => validateReport({ ...good, ...patch });

describe("validateReport", () => {
  it("accepts a real report and drops unknown fields", () => {
    const result = validateReport({ ...good, cookie: "secret", tabs: [1, 2] });
    expect(result).toEqual({ ok: true, report: good });
  });

  it("accepts a full address only on the same site, over http(s)", () => {
    expect(check({ url: "https://news.example.com/story?id=4" }).ok).toBe(true);
    expect(check({ url: "https://evil.example/story" }).ok).toBe(false);
    expect(check({ url: "javascript:alert(1)" }).ok).toBe(false);
  });

  it("rejects anything outside the known shape", () => {
    expect(check({ v: 2 }).ok).toBe(false);
    expect(check({ category: "spam" }).ok).toBe(false);
    expect(check({ hostname: "https://news.example.com" }).ok).toBe(false);
    expect(check({ hostname: "127.0.0.1:80" }).ok).toBe(false);
    expect(check({ hostname: "localhost" }).ok).toBe(false);
    expect(check({ note: "x".repeat(MAX_NOTE_LENGTH + 1) }).ok).toBe(false);
    expect(check({ moatVersion: "latest" }).ok).toBe(false);
    expect(check({ browser: "Chrome 141 <script>" }).ok).toBe(false);
    expect(check({ level: "max" }).ok).toBe(false);
    expect(check({ lists: ["@everyone"] }).ok).toBe(false);
    expect(check({ lists: ["[click](https://evil.example)"] }).ok).toBe(false);
    expect(check({ pausingFixes: "maybe" }).ok).toBe(false);
    expect(validateReport(null).ok).toBe(false);
    expect(validateReport([good]).ok).toBe(false);
  });

  it("accepts every real filter list name", () => {
    const manifest = JSON.parse(readFileSync("rules/dnr/manifest.json", "utf8")) as RulesetManifestEntry[];
    const names = summarizeFilterLists(manifest).map((list) => list.name);
    expect(names.length).toBeGreaterThan(5);
    expect(check({ lists: names }).ok).toBe(true);
  });
});

describe("formatReport", () => {
  it("keeps the note inside a fenced block that it can't close", () => {
    const text = formatReport({ ...good, note: "ok\n```\n# heading @someone ![x](https://evil.example/x.png)" });
    const fences = text.split("\n").filter((line) => line.startsWith("```"));
    expect(fences).toEqual(["```text", "```"]);
    expect(text).toContain("**Does pausing Moat fix it:** Yes");
  });

  it("names the problem and site in the title", () => {
    expect(reportTitle(good)).toBe("Site broken on news.example.com");
  });
});

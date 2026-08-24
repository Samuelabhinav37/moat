import { describe, expect, it } from "vitest";
import { appendEntry } from "./ruleLogger";
import type { LoggedMatch } from "../types";

function entry(url: string): LoggedMatch {
  return { timestamp: 0, url, method: "GET", type: "script", ruleId: 1, rulesetId: "ruleset_ads-1" };
}

describe("appendEntry", () => {
  it("appends to the end", () => {
    const entries = appendEntry([entry("a")], entry("b"), 200);
    expect(entries.map((e) => e.url)).toEqual(["a", "b"]);
  });

  it("evicts the oldest entry once over the max", () => {
    const entries = appendEntry([entry("a"), entry("b")], entry("c"), 2);
    expect(entries.map((e) => e.url)).toEqual(["b", "c"]);
  });

  it("never grows past max even across repeated appends", () => {
    let entries: LoggedMatch[] = [];
    for (let i = 0; i < 250; i += 1) entries = appendEntry(entries, entry(String(i)), 200);
    expect(entries.length).toBe(200);
    expect(entries[0]?.url).toBe("50");
    expect(entries[199]?.url).toBe("249");
  });
});

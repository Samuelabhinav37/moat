import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ruleLogger";
import type { LoggedMatch } from "../types";

function entry(url: string): LoggedMatch {
  return { timestamp: 0, url, method: "GET", type: "script", ruleId: 1, rulesetId: "ruleset_ads-1" };
}

describe("RingBuffer", () => {
  it("returns pushed entries oldest-to-newest", () => {
    const buffer = new RingBuffer<LoggedMatch>(200);
    buffer.push(entry("a"));
    buffer.push(entry("b"));
    expect(buffer.toArray().map((e) => e.url)).toEqual(["a", "b"]);
  });

  it("evicts the oldest entry once over capacity", () => {
    const buffer = new RingBuffer<LoggedMatch>(2);
    buffer.push(entry("a"));
    buffer.push(entry("b"));
    buffer.push(entry("c"));
    expect(buffer.toArray().map((e) => e.url)).toEqual(["b", "c"]);
  });

  it("never grows past capacity even across repeated pushes, and wraps correctly", () => {
    const buffer = new RingBuffer<LoggedMatch>(200);
    for (let i = 0; i < 250; i += 1) buffer.push(entry(String(i)));
    const entries = buffer.toArray();
    expect(entries.length).toBe(200);
    expect(entries[0]?.url).toBe("50");
    expect(entries[199]?.url).toBe("249");
  });

  it("starts empty", () => {
    const buffer = new RingBuffer<LoggedMatch>(200);
    expect(buffer.toArray()).toEqual([]);
  });
});

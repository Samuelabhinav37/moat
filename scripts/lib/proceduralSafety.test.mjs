import { describe, expect, it } from "vitest";
import { isSafeProceduralPrefix, isSafeProceduralTask } from "./proceduralSafety.mjs";
import {
  isSafeProceduralPrefix as isSafeProceduralPrefixRuntime,
  isSafeProceduralTask as isSafeProceduralTaskRuntime,
} from "../../src/shared/proceduralSafety.ts";

const PREFIXES = [".ad-box", "div.wrap > .x", "", "a".repeat(400), ".a}{evil}", ".a`x`", "#main .promo"];
const TASKS = [
  ["has-text", "Sponsored"],
  ["has-text", "/re/i"],
  ["has-text", ""],
  ["has-text", "<script>"],
  ["min-text-length", 40],
  ["min-text-length", -1],
  ["upward", 2],
  ["upward", 999],
  ["upward-sel", ".wrap"],
  ["upward-sel", ".a{x}"],
  ["matches-css", "", "display: none"],
  ["matches-css", "before", "content: /x/"],
  ["matches-css", "bogus", "display: none"],
  ["matches-css", "", "no-colon"],
  ["xpath", "//div[@id='ad']"],
  ["xpath", "x".repeat(1200)],
  ["xpath", "//a<b"],
  ["nope", "x"],
];

describe("proceduralSafety .mjs / .ts parity", () => {
  it("isSafeProceduralPrefix agrees for every sample", () => {
    for (const p of PREFIXES) {
      expect(isSafeProceduralPrefix(p)).toBe(isSafeProceduralPrefixRuntime(p));
    }
  });
  it("isSafeProceduralTask agrees for every sample", () => {
    for (const t of TASKS) {
      expect(isSafeProceduralTask(t)).toBe(isSafeProceduralTaskRuntime(t));
    }
  });
});

describe("isSafeProceduralPrefix", () => {
  it("rejects empty, over-long, and brace/backtick-bearing prefixes", () => {
    expect(isSafeProceduralPrefix("")).toBe(false);
    expect(isSafeProceduralPrefix("a".repeat(400))).toBe(false);
    expect(isSafeProceduralPrefix(".a}{evil}")).toBe(false);
    expect(isSafeProceduralPrefix(".a`x`")).toBe(false);
    expect(isSafeProceduralPrefix("#main .promo")).toBe(true);
  });
});

describe("isSafeProceduralTask", () => {
  it("validates has-text / min-text-length / upward / matches-css / xpath", () => {
    expect(isSafeProceduralTask(["has-text", "Sponsored"])).toBe(true);
    expect(isSafeProceduralTask(["has-text", "<script>"])).toBe(false);
    expect(isSafeProceduralTask(["min-text-length", 40])).toBe(true);
    expect(isSafeProceduralTask(["min-text-length", -1])).toBe(false);
    expect(isSafeProceduralTask(["upward", 999])).toBe(false);
    expect(isSafeProceduralTask(["matches-css", "before", "content: /x/"])).toBe(true);
    expect(isSafeProceduralTask(["matches-css", "bogus", "display: none"])).toBe(false);
    expect(isSafeProceduralTask(["xpath", "//a<b"])).toBe(false);
    expect(isSafeProceduralTask(["nope", "x"])).toBe(false);
  });
});

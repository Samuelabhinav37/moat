import { describe, expect, it } from "vitest";
import { HEURISTIC_DEFS, heuristicAppliesTo } from "./heuristicScope";
import type { UsageSignal } from "../types";

describe("heuristicAppliesTo", () => {
  it("scopes grayscaleAds to the exact YouTube hostnames the content script registers on", () => {
    expect(heuristicAppliesTo("grayscaleAds", "www.youtube.com")).toBe(true);
    expect(heuristicAppliesTo("grayscaleAds", "m.youtube.com")).toBe(true);
    // The bare apex isn't in scripts/manifest.ts's match list -- only the www/m
    // subdomains are, so this must not match even though it's "the same site".
    expect(heuristicAppliesTo("grayscaleAds", "youtube.com")).toBe(false);
    expect(heuristicAppliesTo("grayscaleAds", "example.com")).toBe(false);
  });

  it("scopes feedAdRemoval to Instagram/LinkedIn/YouTube", () => {
    expect(heuristicAppliesTo("feedAdRemoval", "www.instagram.com")).toBe(true);
    expect(heuristicAppliesTo("feedAdRemoval", "www.linkedin.com")).toBe(true);
    expect(heuristicAppliesTo("feedAdRemoval", "www.youtube.com")).toBe(true);
    expect(heuristicAppliesTo("feedAdRemoval", "m.youtube.com")).toBe(true);
    // Bare apex again isn't what the content script actually registers on.
    expect(heuristicAppliesTo("feedAdRemoval", "instagram.com")).toBe(false);
    expect(heuristicAppliesTo("feedAdRemoval", "example.com")).toBe(false);
  });

  it("scopes searchSlop to the known search-engine hostnames", () => {
    expect(heuristicAppliesTo("searchSlop", "www.google.com")).toBe(true);
    expect(heuristicAppliesTo("searchSlop", "www.bing.com")).toBe(true);
    expect(heuristicAppliesTo("searchSlop", "duckduckgo.com")).toBe(true);
    expect(heuristicAppliesTo("searchSlop", "google.com")).toBe(false);
    expect(heuristicAppliesTo("searchSlop", "example.com")).toBe(false);
  });

  it("treats cookieBannerReject, leakedPasswordCheck, fingerprint and cnameUncloak as applying everywhere", () => {
    const everywhereSignals: UsageSignal[] = ["cookieBannerReject", "leakedPasswordCheck", "fingerprint", "cnameUncloak"];
    for (const signal of everywhereSignals) {
      expect(heuristicAppliesTo(signal, "example.com")).toBe(true);
      expect(heuristicAppliesTo(signal, "www.youtube.com")).toBe(true);
      expect(heuristicAppliesTo(signal, "")).toBe(true);
    }
  });
});

describe("HEURISTIC_DEFS", () => {
  it("has exactly one entry per UsageSignal, no duplicates", () => {
    const ids = HEURISTIC_DEFS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    const expected: UsageSignal[] = [
      "fingerprint",
      "cookieBannerReject",
      "feedAdRemoval",
      "grayscaleAds",
      "cnameUncloak",
      "leakedPasswordCheck",
      "searchSlop",
    ];
    expect([...ids].sort()).toEqual([...expected].sort());
  });
});

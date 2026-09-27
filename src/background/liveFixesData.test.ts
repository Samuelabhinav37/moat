/// <reference types="node" />
// Checks the committed live/quick-fixes.json and live/cosmetic-fixes.json with
// the same validators installed copies use, so a merged fix can't be silently
// dropped on every user's machine. sign-live.yml runs this before signing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_QUICK_FIX_RULES, filterValidQuickFixes } from "./quickFixRules";
import { filterValidCosmeticFixes } from "./liveCosmeticFixes";

const read = (name: string) => JSON.parse(readFileSync(`live/${name}`, "utf8")) as unknown;

describe("live fix files", () => {
  it("quick-fixes.json: every entry is valid and within the cap", () => {
    const entries = read("quick-fixes.json");
    expect(Array.isArray(entries)).toBe(true);
    const { rejectedCount, valid } = filterValidQuickFixes(entries as unknown[]);
    expect(rejectedCount).toBe(0);
    expect(valid.length).toBeLessThanOrEqual(MAX_QUICK_FIX_RULES);
  });

  it("cosmetic-fixes.json: every site and selector is accepted", () => {
    const raw = read("cosmetic-fixes.json") as Record<string, string[]>;
    const { valid, rejectedDomains } = filterValidCosmeticFixes(raw);
    expect(rejectedDomains).toBe(0);
    // Every selector kept, not just every site.
    for (const [site, selectors] of Object.entries(raw)) expect(valid[site.toLowerCase()], site).toEqual(selectors);
  });
});

import { describe, expect, it } from "vitest";
import { groupChunkIds, summarizeFilterLists, type RulesetManifestEntry } from "./rulesetManifest";

const manifest: RulesetManifestEntry[] = [
  { id: "ruleset_ads-1", group: "ads", category: "ads", name: "AdGuard Base filter (1/2)", enabled: true, file: "a1.json", ruleCount: 100 },
  { id: "ruleset_ads-2", group: "ads", category: "ads", name: "AdGuard Base filter (2/2)", enabled: true, file: "a2.json", ruleCount: 50 },
  { id: "ruleset_popups", group: "popups", category: "ads", name: "AdGuard Popups filter", enabled: true, file: "p.json", ruleCount: 10 },
  { id: "ruleset_privacy-headers", group: "privacy-headers", category: "core", name: "GPC header", enabled: true, file: "gpc.json", ruleCount: 1 },
];

describe("groupChunkIds", () => {
  it("returns every chunk id belonging to a multi-chunk group", () => {
    expect(groupChunkIds(manifest, "ads")).toEqual(["ruleset_ads-1", "ruleset_ads-2"]);
  });

  it("returns a single id for a single-chunk group", () => {
    expect(groupChunkIds(manifest, "popups")).toEqual(["ruleset_popups"]);
  });

  it("returns an empty array for an unknown group", () => {
    expect(groupChunkIds(manifest, "nonexistent")).toEqual([]);
  });
});

describe("summarizeFilterLists", () => {
  it("collapses chunked entries into one row per group with a summed rule count", () => {
    const rows = summarizeFilterLists(manifest);
    const ads = rows.find((r) => r.group === "ads");
    expect(ads).toEqual({ group: "ads", category: "ads", name: "AdGuard Base filter", ruleCount: 150 });
  });

  it("strips the (n/m) chunk suffix from the display name", () => {
    const rows = summarizeFilterLists(manifest);
    expect(rows.find((r) => r.group === "ads")?.name).toBe("AdGuard Base filter");
  });

  it("keeps a single-chunk list's name unchanged", () => {
    const rows = summarizeFilterLists(manifest);
    expect(rows.find((r) => r.group === "popups")?.name).toBe("AdGuard Popups filter");
  });

  it("excludes core (non-toggleable) entries like the GPC header rule", () => {
    const rows = summarizeFilterLists(manifest);
    expect(rows.find((r) => r.group === "privacy-headers")).toBeUndefined();
  });
});

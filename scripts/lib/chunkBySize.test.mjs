import { describe, expect, it } from "vitest";
import { chunkBySize } from "./chunkBySize.mjs";

describe("chunkBySize", () => {
  it("returns a single empty chunk for an empty input", () => {
    expect(chunkBySize([], 1000)).toEqual([[]]);
  });

  it("keeps everything in one chunk when it fits", () => {
    const rules = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(chunkBySize(rules, 1000)).toEqual([rules]);
  });

  it("splits once the running size would exceed the budget", () => {
    // Each stringified rule is 8 bytes ({"id":N}) + 1 separator = 9.
    const rules = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const chunks = chunkBySize(rules, 20);
    expect(chunks).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }]]);
  });

  it("never drops or reorders rules across chunks", () => {
    const rules = Array.from({ length: 500 }, (_, i) => ({ id: i, urlFilter: `||example${i}.com^` }));
    const chunks = chunkBySize(rules, 512);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(rules);
  });

  it("always places at least one rule per chunk even if it alone exceeds the budget", () => {
    const oversized = { id: 1, blob: "x".repeat(100) };
    const chunks = chunkBySize([oversized, { id: 2 }], 10);
    expect(chunks[0]).toEqual([oversized]);
    expect(chunks.flat()).toEqual([oversized, { id: 2 }]);
  });

  it("keeps every chunk's serialized size under the budget when rules are individually small", () => {
    const rules = Array.from({ length: 200 }, (_, i) => ({ id: i }));
    const maxBytes = 200;
    const chunks = chunkBySize(rules, maxBytes);
    for (const chunk of chunks) {
      expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(maxBytes);
    }
  });
});

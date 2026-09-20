import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLiveFilterSourceProvenance, readPreviousLiveFilterSourceProvenance } from "./liveFilterSourceProvenance.mjs";

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "moat-provenance-test-"));
  mkdirSync(join(root, "rules"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("writeLiveFilterSourceProvenance / readPreviousLiveFilterSourceProvenance", () => {
  it("returns null when nothing has been written yet", () => {
    expect(readPreviousLiveFilterSourceProvenance(root)).toBeNull();
  });

  it("writes a record readable back with matching hashes and stats", () => {
    writeLiveFilterSourceProvenance(root, [
      { name: "peterLowe", url: "https://example.com/list1", text: "a.com\nb.com\n", itemCount: 2 },
      { name: "oisd", url: "https://example.com/list2", text: "c.com\n", itemCount: 1 },
    ]);
    const record = readPreviousLiveFilterSourceProvenance(root);
    expect(record).not.toBeNull();
    expect(Object.keys(record.sources).sort()).toEqual(["oisd", "peterLowe"]);
    expect(record.sources.peterLowe.url).toBe("https://example.com/list1");
    expect(record.sources.peterLowe.itemCount).toBe(2);
    expect(record.sources.oisd.itemCount).toBe(1);
  });

  it("produces a stable hash for the same content and a different one for different content", () => {
    writeLiveFilterSourceProvenance(root, [{ name: "peterLowe", url: "u", text: "same-content", itemCount: 1 }]);
    const first = readPreviousLiveFilterSourceProvenance(root).sources.peterLowe.sha256;

    writeLiveFilterSourceProvenance(root, [{ name: "peterLowe", url: "u", text: "same-content", itemCount: 1 }]);
    const second = readPreviousLiveFilterSourceProvenance(root).sources.peterLowe.sha256;
    expect(second).toBe(first);

    writeLiveFilterSourceProvenance(root, [{ name: "peterLowe", url: "u", text: "different-content", itemCount: 1 }]);
    const third = readPreviousLiveFilterSourceProvenance(root).sources.peterLowe.sha256;
    expect(third).not.toBe(first);
  });

  it("is a real SHA-256 hex digest (64 lowercase hex chars)", () => {
    writeLiveFilterSourceProvenance(root, [{ name: "x", url: "u", text: "hello", itemCount: 1 }]);
    const { sha256 } = readPreviousLiveFilterSourceProvenance(root).sources.x;
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("overwrites the previous record entirely rather than merging", () => {
    writeLiveFilterSourceProvenance(root, [{ name: "a", url: "u", text: "x", itemCount: 1 }]);
    writeLiveFilterSourceProvenance(root, [{ name: "b", url: "u", text: "y", itemCount: 1 }]);
    const record = readPreviousLiveFilterSourceProvenance(root);
    expect(Object.keys(record.sources)).toEqual(["b"]);
  });
});

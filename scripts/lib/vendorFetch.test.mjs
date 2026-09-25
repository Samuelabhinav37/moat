import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAndVendor } from "./vendorFetch.mjs";

const parseLines = (text) => text.split("\n").filter(Boolean);
const requireSome = (lines) => {
  if (lines.length === 0) throw new Error("empty");
};

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vendor-fetch-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function opts(extra = {}) {
  return {
    url: "https://example.com/list",
    describe: "Example list",
    outFile: join(dir, "out", "list.json"),
    parse: parseLines,
    validate: requireSome,
    ...extra,
  };
}

describe("fetchAndVendor", () => {
  it("writes the parsed list, and refreshes the snapshot, on a good fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("a.com\nb.com\n")));
    const snapshotFile = join(dir, "snapshot.json");

    const result = await fetchAndVendor(opts({ snapshotFile }));

    expect(result).toEqual(["a.com", "b.com"]);
    expect(JSON.parse(readFileSync(join(dir, "out", "list.json"), "utf8"))).toEqual(["a.com", "b.com"]);
    expect(JSON.parse(readFileSync(snapshotFile, "utf8"))).toEqual(["a.com", "b.com"]);
  });

  it("still fails on a dead source when there is no snapshot to fall back to", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404, statusText: "Not Found" })));

    await expect(fetchAndVendor(opts())).rejects.toThrow("Failed to fetch Example list: 404 Not Found");
  });

  it("falls back to the committed snapshot, with a warning, when the source is gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404, statusText: "Not Found" })));
    const snapshotFile = join(dir, "snapshot.json");
    writeFileSync(snapshotFile, JSON.stringify(["kept.com"]));

    const result = await fetchAndVendor(opts({ snapshotFile }));

    expect(result).toEqual(["kept.com"]);
    expect(JSON.parse(readFileSync(join(dir, "out", "list.json"), "utf8"))).toEqual(["kept.com"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("404 Not Found"));
  });

  it("falls back to the snapshot on a network error too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")));
    const snapshotFile = join(dir, "snapshot.json");
    writeFileSync(snapshotFile, JSON.stringify(["kept.com"]));

    const result = await fetchAndVendor(opts({ snapshotFile, retryDelayMs: 1 }));

    expect(result).toEqual(["kept.com"]);
  });

  it("never falls back when the source answers but its content is bad", async () => {
    // A reachable source that suddenly parses to nothing is a real problem to
    // look at, not an outage to paper over with an old copy.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));
    const snapshotFile = join(dir, "snapshot.json");
    writeFileSync(snapshotFile, JSON.stringify(["kept.com"]));

    await expect(fetchAndVendor(opts({ snapshotFile }))).rejects.toThrow("empty");
    expect(existsSync(join(dir, "out", "list.json"))).toBe(false);
  });

  it("validates the snapshot as well, so a broken one can't ship", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404, statusText: "Not Found" })));
    const snapshotFile = join(dir, "snapshot.json");
    writeFileSync(snapshotFile, JSON.stringify([]));

    await expect(fetchAndVendor(opts({ snapshotFile }))).rejects.toThrow("empty");
  });
});

// Records a SHA-256 + basic stats for each of the third-party filter
// sources scripts/update-filters.mjs fetches live at build time (jarelllama/
// Scam-Blocklist, Peter Lowe's list, oisd small) -- see
// docs/RELEASING.md's "Filter lists" section for the reproducibility gap
// this exists to shrink: those three sources' actual rule content lands in
// the gitignored rules/dnr/, invisible to the weekly filter-refresh PR's
// diff no matter how much it changes. This can't make that content
// reviewable line-by-line (it isn't tracked, on purpose -- ~349,000 rules
// isn't something to put in git), but it makes CHANGE itself visible: this
// file IS tracked, so a hash flipping in the PR diff tells a reviewer "one
// of these three sources' content actually changed this week," which today
// they have no way to know at all.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * @param {string} root repo root
 * @param {Array<{ name: string, url: string, text: string, itemCount: number }>} sources
 */
export function writeLiveFilterSourceProvenance(root, sources) {
  const path = join(root, "rules", "live-filter-source-provenance.json");
  const record = {
    generatedAt: new Date().toISOString(),
    sources: Object.fromEntries(
      sources.map(({ name, url, text, itemCount }) => [
        name,
        { url, sha256: sha256Hex(text), byteLength: Buffer.byteLength(text, "utf8"), itemCount },
      ])
    ),
  };
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  return path;
}

/** Reads back the previously-committed record, if any -- lets the caller
 * log whether a source's hash actually changed since the last commit,
 * rather than just always overwriting silently. Returns null on a fresh
 * checkout with no prior record (first run, or the file was never
 * committed yet). */
export function readPreviousLiveFilterSourceProvenance(root) {
  const path = join(root, "rules", "live-filter-source-provenance.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

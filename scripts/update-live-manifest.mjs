// Regenerates live/manifest.json -- a SHA-256 index of the files in live/ that
// src/background/liveUpdates.ts fetches at runtime. The extension fetches this
// manifest first, then verifies each payload's bytes against it: a mismatch
// (CDN corruption, or a stale payload racing a fresh manifest during jsDelivr
// propagation) is rejected and the bundled baseline kept, rather than a
// half-applied update. It is NOT a signature -- the manifest is fetched over
// the wire like the payloads; TLS + the GitHub account remain the source of
// trust, and the runtime shape validators bound what a compromised source
// could do.
//
// Run as the last step of `npm run filters:update`, and by hand any time a
// live/*.json is edited (then `git push` and `node scripts/purge-live-cdn.mjs`).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const liveDir = join(dirname(fileURLToPath(import.meta.url)), "..", "live");

// Everything in live/ except the manifest itself.
const TRACKED_FILES = ["redirect-domains.json", "quick-fixes.json", "cosmetic-fixes.json"];

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

const files = {};
for (const name of TRACKED_FILES) {
  const path = join(liveDir, name);
  // Normalise to LF and hash that: the CDN serves the git blob (LF), so the
  // runtime's sha256(fetched bytes) must match sha256(LF bytes), not whatever
  // the working copy happens to have on a CRLF checkout. Rewrite the file too
  // so disk, git, CDN and manifest all agree.
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  JSON.parse(text); // fail the build here on broken JSON, not silently at a client
  writeFileSync(path, text);
  files[name] = sha256Hex(Buffer.from(text, "utf8"));
}

// No timestamp field: the manifest is byte-stable when the hashes don't
// change, so re-running this (every `filters:update`, every CI run) produces
// no git diff unless a live file actually changed.
const outPath = join(liveDir, "manifest.json");
writeFileSync(outPath, JSON.stringify({ files }, null, 2) + "\n");

console.log(`live/manifest.json updated (${TRACKED_FILES.length} files)`);
for (const [name, hash] of Object.entries(files)) console.log(`  ${name}  ${hash}`);

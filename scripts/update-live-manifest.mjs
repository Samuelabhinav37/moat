// Regenerates live/manifest.json -- a SHA-256 index of the files in live/ that
// src/background/liveUpdates.ts fetches at runtime. The extension fetches this
// manifest first, then verifies each payload's bytes against it before applying.
//
// If the env var LIVE_SIGNING_PRIVATE_KEY holds an Ed25519 private-key PEM
// (see scripts/gen-live-signing-key.mjs), this also writes
// live/manifest.json.sig -- a detached base64 signature over the manifest
// bytes. When src/shared/liveSigningKey.ts carries the matching public key,
// the runtime rejects any manifest whose signature doesn't verify, so trust
// moves from "the GitHub account" to "whoever holds the signing key". Without
// the env var, any stale .sig is removed and the channel stays hash-only.
//
// Run as the last step of `npm run filters:update`, and by hand any time a
// live/*.json is edited (then `git push`).
import { createHash, sign as edSign, createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const liveDir = join(dirname(fileURLToPath(import.meta.url)), "..", "live");

// Everything in live/ except the manifest itself.
const TRACKED_FILES = [
  "redirect-domains.json",
  "quick-fixes.json",
  "cosmetic-fixes.json",
  "youtube-quick-fixes.json",
];

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
const manifestBytes = Buffer.from(JSON.stringify({ files }, null, 2) + "\n", "utf8");
writeFileSync(outPath, manifestBytes);

const sigPath = join(liveDir, "manifest.json.sig");
const keyPem = process.env.LIVE_SIGNING_PRIVATE_KEY;
if (keyPem && keyPem.includes("PRIVATE KEY")) {
  const sig = edSign(null, manifestBytes, createPrivateKey(keyPem));
  writeFileSync(sigPath, sig.toString("base64") + "\n");
  console.log(`live/manifest.json + .sig updated (${TRACKED_FILES.length} files, signed)`);
} else {
  if (existsSync(sigPath)) rmSync(sigPath);
  console.log(`live/manifest.json updated (${TRACKED_FILES.length} files, unsigned)`);
}
for (const [name, hash] of Object.entries(files)) console.log(`  ${name}  ${hash}`);

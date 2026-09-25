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
import { createHash, sign as edSign, verify as edVerify, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

// The public key lives in TS source the extension bundles; read it from there
// rather than duplicating it, so a key rotation can't leave this check stale.
function shippedPublicKey() {
  const src = readFileSync(join(liveDir, "..", "src", "shared", "liveSigningKey.ts"), "utf8");
  return src.match(/LIVE_MANIFEST_PUBLIC_KEY\s*=\s*"([^"]*)"/)?.[1] ?? "";
}

function committedSigStillVerifies(manifestBytes) {
  const raw = shippedPublicKey();
  if (!raw) return false;
  try {
    // SPKI DER for Ed25519 = fixed 12-byte header + the 32-byte raw key.
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(raw, "base64")]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    const sig = Buffer.from(readFileSync(join(liveDir, "manifest.json.sig"), "utf8").trim(), "base64");
    return edVerify(null, manifestBytes, key, sig);
  } catch {
    return false;
  }
}

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
} else if (existsSync(sigPath) && committedSigStillVerifies(manifestBytes)) {
  // No key this run, but the manifest bytes are unchanged and the committed
  // .sig still verifies against the shipped public key -- keep it. This is
  // the ordinary CI / release / fork-PR case: every workflow runs
  // filters:update, and only the one that actually changes live/*.json
  // (filter-refresh.yml, which is given the secret) needs to re-sign.
  console.log(`live/manifest.json unchanged, existing .sig still verifies (${TRACKED_FILES.length} files, signed)`);
} else if (existsSync(sigPath)) {
  // A committed .sig with no key available this run used to be silently
  // deleted here, which would let the live channel quietly regress from
  // signed to hash-only trust with no CI failure and no visible diff other
  // than a deleted file in the same commit as everything else
  // filters:update touches. Refuse instead -- reaching this branch means a
  // live/*.json actually changed (an unchanged manifest is handled above),
  // so either the signing key was expected and isn't present, or someone
  // means to drop signing on purpose and should say so explicitly.
  console.error(
    "live/*.json changed and live/manifest.json.sig no longer verifies, but LIVE_SIGNING_PRIVATE_KEY is not set for this run -- " +
      "refusing to silently drop the signature. If you're deliberately turning signing off, " +
      "remove live/manifest.json.sig yourself first (git rm live/manifest.json.sig)."
  );
  process.exit(1);
} else {
  console.log(`live/manifest.json updated (${TRACKED_FILES.length} files, unsigned)`);
}
for (const [name, hash] of Object.entries(files)) console.log(`  ${name}  ${hash}`);

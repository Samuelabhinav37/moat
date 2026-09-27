// Checks that live/ is safe to publish as it stands: every file listed in
// live/manifest.json matches its SHA-256 there, and manifest.json.sig is a
// valid signature over the manifest with the public key the extension ships
// (src/shared/liveSigningKey.ts). Installed copies reject a live file that
// fails either check, so publishing an unsigned or stale manifest would only
// make them drop that day's updates.
//
// publish-live.yml runs this first and skips publishing when it fails: a fix
// merged into live/ (a report PR) is published by sign-live.yml once it has
// re-signed the manifest with the key that only GitHub holds.
//
//   node scripts/check-live-manifest.mjs     exit 0 = ready, 1 = not signed for these files
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const live = join(root, "live");
const problems = [];

const manifestBytes = readFileSync(join(live, "manifest.json"));
const { files = {} } = JSON.parse(manifestBytes.toString("utf8"));
for (const [name, expected] of Object.entries(files)) {
  const path = join(live, name);
  if (!existsSync(path)) {
    problems.push(`${name} is listed but missing`);
    continue;
  }
  // Hash the LF form, as update-live-manifest.mjs and the CDN do.
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const actual = createHash("sha256").update(text, "utf8").digest("hex");
  if (actual !== expected) problems.push(`${name} changed since the manifest was signed`);
}

const keySource = readFileSync(join(root, "src", "shared", "liveSigningKey.ts"), "utf8");
const raw = keySource.match(/LIVE_MANIFEST_PUBLIC_KEY\s*=\s*"([^"]*)"/)?.[1] ?? "";
const sigPath = join(live, "manifest.json.sig");
if (raw && !existsSync(sigPath)) problems.push("manifest.json.sig is missing");
if (raw && existsSync(sigPath)) {
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(raw, "base64")]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  const sig = Buffer.from(readFileSync(sigPath, "utf8").trim(), "base64");
  const bytes = Buffer.from(manifestBytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  if (!verify(null, bytes, key, sig)) problems.push("manifest.json.sig doesn't verify");
}

if (problems.length) {
  for (const p of problems) console.log(`not ready: ${p}`);
  process.exit(1);
}
console.log(`live/ is signed and matches (${Object.keys(files).length} files).`);

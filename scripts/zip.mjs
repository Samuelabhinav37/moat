// Zips dist/chrome and dist/firefox for store upload (Chrome Web Store /
// AMO both want a plain zip of the built extension directory).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

for (const target of ["chrome", "firefox"]) {
  const dir = resolve(root, "dist", target);
  if (!existsSync(dir)) {
    console.log(`Skipping ${target}: dist/${target} doesn't exist (run npm run build:${target} first).`);
    continue;
  }
  // Chrome writes its own _metadata/generated_indexed_rulesets/ into a
  // dist/<target> dir the first time it loads that build unpacked (local
  // testing/debugging) -- npm run build wipes dist/<target> before every
  // build, so a normal build-then-zip never sees it, but a zip run without a
  // preceding rebuild would otherwise silently package ~12MB of Chrome's own
  // internal cache into the store submission. Warn (non-fatal -- the
  // --exclude below is the real guard) so a stale-metadata situation is
  // visible, not just silently filtered away.
  const metadataDir = resolve(dir, "_metadata");
  if (existsSync(metadataDir)) {
    console.warn(`Warning: ${target}.zip build directory has a _metadata/ dir (from loading unpacked for local ` +
      `testing). Excluding it from the zip, but consider running npm run build:${target} first to be sure ` +
      `you're zipping a clean, current build.`);
  }

  const zipPath = resolve(root, `${target}.zip`);
  // Windows ships tar.exe with zip support since Windows 10 1803+; avoids
  // pulling in a zip library dependency for a one-off packaging step.
  execFileSync(
    "tar",
    ["--force-local", "-a", "-c", "-f", zipPath, "--exclude=_metadata", "-C", dir, "."],
    { stdio: "inherit" }
  );
  console.log(`Wrote ${target}.zip`);
}

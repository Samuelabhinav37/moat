// Zips dist/chrome and dist/firefox for store upload (Chrome Web Store /
// AMO both want a plain zip of the built extension directory).
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// `tar -a -c -f x.zip ...` (the previous approach) silently does the wrong
// thing under GNU tar -- it doesn't know how to produce the zip container
// format via -a (that only auto-selects a *compression* program for a tar
// stream, e.g. gzip/xz), so it falls through to writing a plain uncompressed
// tar archive with a .zip extension. Confirmed on this machine (`file
// chrome.zip` reported "POSIX tar archive (GNU)", not a zip) -- and since
// this script also runs on ubuntu-latest in CI (.github/workflows/release.yml),
// every tagged release's store-upload zips were almost certainly the same
// broken non-zip file, not just a local dev-machine issue. Windows' own
// bsdtar (System32\tar.exe) *does* support -a correctly, but Git Bash's GNU
// tar shadows it on PATH here, and CI is Ubuntu regardless -- so this uses
// each platform's actual zip tool instead of relying on `tar` at all.
function createZip(sourceDir, destZipPath) {
  if (existsSync(destZipPath)) rmSync(destZipPath);
  if (process.platform === "win32") {
    // Compress-Archive is built into Windows (PowerShell 5.1+, no extra
    // install) and produces a real, correctly-compressed zip.
    // Get-ChildItem's -Exclude is silently a no-op when combined with
    // -LiteralPath -- confirmed directly (a _metadata/ dir, Chrome's own
    // ~12MB runtime cache, still leaked into the archive with -LiteralPath).
    // It only takes effect alongside a wildcard -Path, hence the trailing
    // \* here -- also what makes each item land at the archive's top level
    // instead of nested under one wrapper folder.
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-ChildItem -Path '${sourceDir}\\*' -Exclude '_metadata' | ` +
          `Compress-Archive -DestinationPath '${destZipPath}' -CompressionLevel Optimal -Force`,
      ],
      { stdio: "inherit" }
    );
  } else {
    // -X: no extra file attributes/timestamps, for reproducible output.
    execFileSync("zip", ["-r", "-X", destZipPath, ".", "-x", "_metadata/*"], {
      cwd: sourceDir,
      stdio: "inherit",
    });
  }
}

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
  createZip(dir, zipPath);
  console.log(`Wrote ${target}.zip`);
}

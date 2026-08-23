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
  const zipPath = resolve(root, `${target}.zip`);
  // Windows ships tar.exe with zip support since Windows 10 1803+; avoids
  // pulling in a zip library dependency for a one-off packaging step.
  execFileSync("tar", ["--force-local", "-a", "-c", "-f", zipPath, "-C", dir, "."], { stdio: "inherit" });
  console.log(`Wrote ${target}.zip`);
}

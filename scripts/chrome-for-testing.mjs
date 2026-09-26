// Chrome for Testing for the scripts that drive a real browser: CHROME_PATH
// if set, otherwise the current stable build, downloaded once into the
// gitignored .cache/chrome-for-testing. Branded Chrome ignores
// --load-extension, which is why these don't use an installed Chrome.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Browser, computeExecutablePath, detectBrowserPlatform, install, resolveBuildId } from "@puppeteer/browsers";

export async function chromePath(root) {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheDir = join(root, ".cache", "chrome-for-testing");
  const platform = detectBrowserPlatform();
  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  const executablePath = computeExecutablePath({ browser: Browser.CHROME, buildId, cacheDir });
  if (!existsSync(executablePath)) {
    console.log(`Downloading Chrome for Testing ${buildId}...`);
    await install({ browser: Browser.CHROME, buildId, cacheDir });
  }
  return executablePath;
}

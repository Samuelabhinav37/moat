// Chrome for Testing for the scripts that drive a real browser: CHROME_PATH
// if set, otherwise the current stable build, downloaded once into the
// gitignored .cache/chrome-for-testing. Branded Chrome ignores
// --load-extension, which is why these don't use an installed Chrome.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
} from "@puppeteer/browsers";

export async function chromePath(root) {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheDir = join(root, ".cache", "chrome-for-testing");
  const platform = detectBrowserPlatform();
  let buildId;
  try {
    buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
  } catch (error) {
    // Looking up the current stable version needs the network; a blip
    // there shouldn't fail a check when a build is already downloaded.
    const cached = (await getInstalledBrowsers({ cacheDir }))
      .filter((b) => b.browser === Browser.CHROME && b.platform === platform)
      .sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }));
    if (cached.length === 0) throw error;
    buildId = cached[0].buildId;
    console.log(`Couldn't check the current Chrome version (${error.code ?? error.message}); using cached ${buildId}.`);
  }
  const executablePath = computeExecutablePath({ browser: Browser.CHROME, buildId, cacheDir });
  if (!existsSync(executablePath)) {
    console.log(`Downloading Chrome for Testing ${buildId}...`);
    await install({ browser: Browser.CHROME, buildId, cacheDir });
  }
  return executablePath;
}

// Builds the extension for one browser target. Each entry point is built as
// its own standalone Rollup graph (format: "iife") rather than as multiple
// inputs in one build -- Rollup can't emit IIFE output for a code-split
// build, and content scripts / the background worker must each be a single
// self-contained file with no shared chunk to import.
import { build } from "vite";
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { buildManifest } from "./manifest.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Pin the exact resolved path so every entry's independent Rollup graph
// bundles the *same* module instance -- without this, per-entry builds have
// been observed to resolve two differently-cased absolute paths for this
// CJS package on Windows and bundle it twice.
const polyfillPath = createRequire(import.meta.url).resolve("webextension-polyfill");

const target = process.argv[2];
const watch = process.argv.includes("--watch");

if (target !== "chrome" && target !== "firefox") {
  console.error('Usage: node scripts/build.mjs <chrome|firefox> [--watch]');
  process.exit(1);
}

const ENTRIES = [
  ["background", "src/background/index.ts"],
  ["main-world-guard", "src/content/mainWorldGuard.ts"],
  ["fingerprint-guard", "src/content/fingerprintGuard.ts"],
  ["bridge", "src/content/bridge.ts"],
  ["cosmetic-filter", "src/content/cosmeticFilter.ts"],
  ["element-picker", "src/content/elementPicker.ts"],
  ["youtube-ad-dimmer", "src/content/youtubeAdDimmer.ts"],
  ["feed-ad-scanner", "src/content/feedAdScanner.ts"],
  ["consent-rejector", "src/content/consentRejector.ts"],
  ["leaked-password-check", "src/content/leakedPasswordCheck.ts"],
  ["popup", "src/popup/popup.ts"],
  ["options", "src/options/options.ts"],
  ["logger", "src/logger/logger.ts"],
];

const outDir = resolve(root, "dist", target);
try {
  rmSync(outDir, { recursive: true, force: true });
} catch (err) {
  // force:true only suppresses ENOENT (path doesn't exist) -- a locked file
  // (an editor, a stray preview server, or the browser with the unpacked
  // extension loaded) throws EPERM/EBUSY here instead, which used to surface
  // as a raw Node stack trace with no indication of the actual cause.
  console.error(
    `\nCouldn't remove dist/${target} -- it looks like something else has it open ` +
      `(an editor, a running preview server, or the browser with the unpacked extension loaded).\n` +
      `Close whatever's holding it and retry.\n`
  );
  throw err;
}
mkdirSync(outDir, { recursive: true });

// Each entry is a fully independent Rollup graph with no shared state, so
// these run in parallel rather than one at a time -- logLevel: "warn" keeps
// interleaved output from different entries rare (only warnings, not the
// normal per-file build log) in the common case where nothing warns.
await Promise.all(
  ENTRIES.map(([name, entry]) =>
    build({
      root,
      configFile: false,
      logLevel: "warn",
      resolve: {
        alias: { "webextension-polyfill": polyfillPath },
      },
      build: {
        outDir,
        emptyOutDir: false,
        target: "es2022",
        // Unminified in --watch (dev) so stack traces/breakpoints stay
        // readable; minified for real builds -- content scripts run on every
        // page load at document_start, so shipping them unminified was pure
        // waste for anyone actually installing the extension.
        minify: watch ? false : "esbuild",
        watch: watch ? {} : undefined,
        rollupOptions: {
          input: { [name]: resolve(root, entry) },
          output: { format: "iife", entryFileNames: "[name].js" },
        },
      },
    })
  )
);

copyStaticAssets();
console.log(`Built ${target} -> dist/${target}`);

if (watch) {
  console.log("Watching for changes (static assets are copied once at startup)...");
}

function copyStaticAssets() {
  const rulesDir = resolve(root, "rules", "dnr");
  if (!existsSync(rulesDir)) {
    throw new Error('rules/dnr is missing. Run "npm run filters:update" first.');
  }
  const redirectResourcesDir = resolve(root, "rules", "redirect-resources");
  if (!existsSync(redirectResourcesDir)) {
    throw new Error('rules/redirect-resources is missing. Run "npm run filters:update" first.');
  }

  mkdirSync(resolve(outDir, "rules"), { recursive: true });
  mkdirSync(resolve(outDir, "icons"), { recursive: true });
  mkdirSync(resolve(outDir, "web-accessible-resources", "redirects"), { recursive: true });
  cpSync(redirectResourcesDir, resolve(outDir, "web-accessible-resources", "redirects"), { recursive: true });

  const rulesetFiles = JSON.parse(readFileSync(resolve(rulesDir, "manifest.json"), "utf8")).map((r) => r.file);
  const cosmeticsManifest = JSON.parse(readFileSync(resolve(rulesDir, "cosmetics-manifest.json"), "utf8"));
  const bucketFiles = Array.from({ length: cosmeticsManifest.bucketCount }, (_, i) => `cosmetics-bucket-${i}.json`);
  const cosmeticsFiles = ["cosmetics-manifest.json", cosmeticsManifest.meta, ...bucketFiles];

  // manifest.json itself is now also a runtime asset (not just read at build
  // time by scripts/manifest.ts) -- the Filter Lists settings tab fetches it
  // to know what rulesets exist and how they're grouped.
  for (const file of [
    ...rulesetFiles,
    "manifest.json",
    "redirect-domains.json",
    "rule-companies.json",
    "consent-rules.json",
    "cname-cloak-destinations.json",
    ...cosmeticsFiles,
  ]) {
    cpSync(resolve(rulesDir, file), resolve(outDir, "rules", file));
  }

  cpSync(resolve(root, "icons"), resolve(outDir, "icons"), { recursive: true });
  cpSync(resolve(root, "src/_locales"), resolve(outDir, "_locales"), { recursive: true });
  cpSync(resolve(root, "src/ui/theme.css"), resolve(outDir, "theme.css"));
  cpSync(resolve(root, "src/popup/popup.html"), resolve(outDir, "popup.html"));
  cpSync(resolve(root, "src/options/options.html"), resolve(outDir, "options.html"));
  cpSync(resolve(root, "src/logger/logger.html"), resolve(outDir, "logger.html"));
  cpSync(resolve(root, "src/managed_schema.json"), resolve(outDir, "managed_schema.json"));

  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(buildManifest(target), null, 2));
}

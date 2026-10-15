// The old site at samuelabhinav37.github.io/moat/ now only sends visitors to
// samuelabhinav.com/moat/. publish-live.yml writes these stubs next to live/,
// which stays on GitHub Pages because every installed copy fetches it there.
//
//   node scripts/site-redirects.mjs <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN, BASE } from "./site/chrome.mjs";

// Old path (under /moat/ on github.io) -> new path under samuelabhinav.com.
export const MOVED = { "": BASE, "privacy/": `${BASE}privacy/` };

export function stub(to) {
  const url = ORIGIN + to;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moat has moved</title>
<link rel="canonical" href="${url}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${url}">
<script>location.replace(${JSON.stringify(url)} + location.hash);</script>
</head>
<body style="background:#000;color:#f5f5f7;font:17px system-ui,sans-serif;padding:48px">
<p>Moat's site is now at <a style="color:#2997ff" href="${url}">${url}</a>.</p>
</body>
</html>
`;
}

export function writeRedirects(outDir) {
  for (const [from, to] of Object.entries(MOVED)) {
    mkdirSync(join(outDir, from), { recursive: true });
    writeFileSync(join(outDir, from, "index.html"), stub(to));
  }
  writeFileSync(join(outDir, "404.html"), stub(BASE));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node scripts/site-redirects.mjs <outDir>"); process.exit(2); }
  writeRedirects(out);
  console.log(`Wrote redirect pages to ${out}`);
}

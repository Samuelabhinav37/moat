// Publishes the privacy policy on the website (site/privacy/index.html), built
// from the same PRIVACY.md as the extension's own privacy page. Store reviewers
// and their link checkers need a plain web page: GitHub's file view answers
// automated requests with errors, so the Chrome Web Store called it "not
// reachable".
//
//   npm run site:privacy            write site/privacy/index.html
//   npm run site:privacy -- --check fail if it's out of date (CI)
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDocs } from "./docs/buildDocs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "site", "privacy", "index.html");
const SITE = "https://samuelabhinav37.github.io/moat/";
const REPO = "https://github.com/Samuelabhinav37/moat/blob/master/";

export function sitePrivacyPage() {
  const tmp = mkdtempSync(join(tmpdir(), "moat-privacy-"));
  try {
    buildDocs(root, tmp);
    let html = readFileSync(join(tmp, "privacy.html"), "utf8");
    const css = ["src/ui/theme.css", "src/ui/components.css", "src/docs/doc.css"]
      .map((p) => readFileSync(join(root, p), "utf8"))
      .join("\n");
    html = html
      // Styles inline; no extension scripts (theme-boot reads extension storage).
      .replace(/<link rel="stylesheet" href="components\.css"><link rel="stylesheet" href="doc\.css">/, `<style>${css}</style>`)
      // Light or dark from the visitor's system, the way theme-boot does in the extension.
      .replace(/<script src="theme-boot\.js"><\/script>/, `<script>document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";</script>`)
      // The one bit of docs.js this page needs: the phone's "On this page" menu.
      .replace(/<script src="docs\.js"><\/script>/, `<script>document.querySelector("[data-tocm]")?.addEventListener("change", (e) => { const t = document.getElementById(e.target.value); if (!t) return; if (t.tagName === "DETAILS") t.open = true; t.scrollIntoView(); });</script>`)
      // The extension's "back to Settings" becomes "back to the website".
      .replace(/(<a class="back" href=")options\.html#about(">[\s\S]*?<\/svg>)Settings(<\/a>)/, `$1${SITE}$2Moat$3`)
      .replace(/(<a class="moat-brand" href=")options\.html#about(" aria-label=")Moat settings/, `$1${SITE}$2Moat website`)
      // Document links that only exist inside the extension point to GitHub.
      .replace(/href="privacy\.html"/g, 'href="./"')
      .replace(/href="changelog\.html"/g, `href="${REPO}CHANGELOG.md"`)
      .replace(/href="licenses\.html"/g, `href="${REPO}NOTICE.md"`)
      .replace(/<a href="logger\.html"[\s\S]*?<\/a>/, "")
      .replace(/href="options\.html[^"]*"/g, `href="${SITE}"`)
      // The version line would go stale on the website between releases.
      .replace(/<span>·<\/span><span>Moat [\d.]+<\/span>/, "")
      .replace(/<span>Moat [\d.]+<\/span>/, "");
    return `<!-- Built by scripts/site-privacy.mjs from PRIVACY.md. Don't edit by hand. -->\n${html}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// The "Updated <date>" line comes from git history, which a shallow CI
// checkout may not have, so --check compares the rest.
const withoutDate = (html) => html.replace(/<span>Updated [^<]*<\/span>/, "");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const page = sitePrivacyPage();
  if (process.argv.includes("--check")) {
    const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
    if (withoutDate(current) !== withoutDate(page)) {
      console.error('site/privacy/index.html is out of date with PRIVACY.md. Run "npm run site:privacy" and commit it.');
      process.exit(1);
    }
    console.log("site/privacy/index.html matches PRIVACY.md");
  } else {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, page);
    console.log(`Wrote ${outFile}`);
  }
}

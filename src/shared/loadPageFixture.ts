// Test-only. Loads a real extension page's actual markup + actual CSS
// (including its external <link>, which jsdom never fetches on its own)
// into the current jsdom document, so options.render.test.ts /
// popup.render.test.ts exercise the real HTML/CSS a user's browser would
// parse -- not a hand-copied approximation of it.
import { readFileSync } from "node:fs";

/** `htmlPath` and every path in `cssPaths` are resolved relative to the
 * calling test file (pass `new URL("../options/options.html", import.meta.url)`
 * -style paths, or plain fs paths -- readFileSync takes either). */
export function loadPageFixture(htmlPath: string, cssPaths: string[]): void {
  const html = readFileSync(htmlPath, "utf8");
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const body = bodyMatch?.[1] ?? "";
  const inlineStyleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? "");
  const externalCss = cssPaths.map((p) => readFileSync(p, "utf8"));

  document.head.innerHTML = "";
  for (const css of [...externalCss, ...inlineStyleMatches]) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
  }
  // Strip <script> tags from the body markup -- this fixture is for real
  // options.ts/popup.ts source to run against via a dynamic import, not for
  // the page's own <script src="..."> tags (which point at a built bundle
  // that doesn't exist in this context) to execute.
  document.body.innerHTML = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
}

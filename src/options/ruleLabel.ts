// Hidden on pages lists what someone hid with the picker. Moat stores only
// the CSS selector ("#sponsor-box", "div.ad-slot > img"), which means
// nothing to most people. This turns it into words: the kind of thing
// (the picker card's own names: Image, Link, Box...) and, when the page
// gave it a readable id or class, that name ("Box: sponsor box").

export type RuleKind = "image" | "frame" | "video" | "link" | "text" | "box";

const TAG_KIND: Record<string, RuleKind> = {
  img: "image",
  picture: "image",
  svg: "image",
  iframe: "frame",
  video: "video",
  a: "link",
  p: "text",
  h1: "text",
  h2: "text",
  h3: "text",
  span: "text",
};

/** The last element in a selector: "div.feed > article.ad" -> "article.ad". */
function lastCompound(selector: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]!;
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (depth === 0 && (ch === " " || ch === ">" || ch === "+" || ch === "~")) start = i + 1;
  }
  return selector.slice(start).trim();
}

/** Words from an id or class, skipping names that are just generated
 * hashes ("css-1x9ab2", "_3fZq7"). */
function readableName(token: string): string | null {
  const words = token
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);
  // Any part with digits means a generated name as a whole ("css-1x9ab2").
  if (!words.length || words.some((word) => /\d/.test(word))) return null;
  const readable = words.filter((word) => word.length > 1);
  return readable.length ? readable.slice(0, 3).join(" ").toLowerCase() : null;
}

export function describeSelector(selector: string): { kind: RuleKind; name: string | null } {
  const last = lastCompound(selector);
  const tag = /^[a-z][a-z0-9-]*/i.exec(last)?.[0]?.toLowerCase() ?? "";
  const kind = TAG_KIND[tag] ?? "box";
  const id = /#([\w-]+)/.exec(last)?.[1];
  const classes = Array.from(last.matchAll(/\.([\w-]+)/g), (m) => m[1]!);
  for (const token of [id, ...classes]) {
    if (!token) continue;
    const name = readableName(token);
    if (name) return { kind, name };
  }
  return { kind, name: null };
}

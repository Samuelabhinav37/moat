// The one shape of a problem report, shared by the report page
// (src/report/report.ts), which builds and shows it, and the report service
// (report-worker/), which checks it again before filing it. Everything a
// report can contain is here, so the "What will be sent" preview on the page
// is the whole story: there are no hidden fields.

export const REPORT_VERSION = 1;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_URL_LENGTH = 2000;
export const MAX_LISTS = 40;

export const REPORT_CATEGORIES = ["ads", "broken", "cookie", "other"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const PAUSE_ANSWERS = ["yes", "no", "untried"] as const;
export type PauseAnswer = (typeof PAUSE_ANSWERS)[number];

export interface ProblemReport {
  v: typeof REPORT_VERSION;
  category: ReportCategory;
  /** The site's host name, e.g. "news.example.com". Never a full address. */
  hostname: string;
  /** Only when the person ticked "Include the full page address". */
  url?: string;
  note: string;
  moatVersion: string;
  /** e.g. "Chrome 141" or "Firefox 144". */
  browser: string;
  /** The blocking level in use: lite, essential, standard, strict, custom or off. */
  level: string;
  /** Names of the filter lists switched on. */
  lists: string[];
  /** Whether pausing Moat on the site fixed it. */
  pausingFixes: PauseAnswer;
}

// A plain host name: labels of letters, digits and hyphens, at least one dot,
// no IP-literal brackets, no port. Lowercase only (callers lowercase first).
const HOSTNAME = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const BROWSER = /^(?:Chrome|Chromium|Edge|Brave|Opera|Firefox|Other)(?: \d{1,4})?$/;
const LEVEL = /^(?:lite|essential|standard|strict|custom|off)$/;
// List names go into the filed issue as text, so no markdown or mention
// characters (@ # * _ ` [ ] < >), just what real list names use.
const LIST_NAME = /^[\p{L}\p{N} .,()'&+/-]{1,80}$/u;

export function isHostname(value: unknown): value is string {
  return typeof value === "string" && HOSTNAME.test(value);
}

/** Checks something claimed to be a report, field by field. Returns the
 * report with only the known fields (anything extra is dropped), or the
 * first problem found. */
export function validateReport(input: unknown): { ok: true; report: ProblemReport } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: "not an object" };
  const r = input as Record<string, unknown>;
  if (r.v !== REPORT_VERSION) return { ok: false, error: "unknown version" };
  if (!(REPORT_CATEGORIES as readonly unknown[]).includes(r.category)) return { ok: false, error: "category" };
  if (!isHostname(r.hostname)) return { ok: false, error: "hostname" };
  if (r.url !== undefined) {
    if (typeof r.url !== "string" || r.url.length > MAX_URL_LENGTH) return { ok: false, error: "url" };
    let parsed: URL;
    try {
      parsed = new URL(r.url);
    } catch {
      return { ok: false, error: "url" };
    }
    // Same site as the report names (which drops a leading "www.").
    const urlHost = parsed.hostname.replace(/^www\./, "");
    if (!/^https?:$/.test(parsed.protocol) || urlHost !== r.hostname) return { ok: false, error: "url" };
  }
  if (typeof r.note !== "string" || r.note.length > MAX_NOTE_LENGTH) return { ok: false, error: "note" };
  if (typeof r.moatVersion !== "string" || !VERSION.test(r.moatVersion)) return { ok: false, error: "moatVersion" };
  if (typeof r.browser !== "string" || !BROWSER.test(r.browser)) return { ok: false, error: "browser" };
  if (typeof r.level !== "string" || !LEVEL.test(r.level)) return { ok: false, error: "level" };
  if (
    !Array.isArray(r.lists) ||
    r.lists.length > MAX_LISTS ||
    !r.lists.every((name) => typeof name === "string" && LIST_NAME.test(name))
  )
    return { ok: false, error: "lists" };
  if (!(PAUSE_ANSWERS as readonly unknown[]).includes(r.pausingFixes)) return { ok: false, error: "pausingFixes" };
  const report: ProblemReport = {
    v: REPORT_VERSION,
    category: r.category as ReportCategory,
    hostname: r.hostname,
    note: r.note,
    moatVersion: r.moatVersion,
    browser: r.browser,
    level: r.level,
    lists: r.lists as string[],
    pausingFixes: r.pausingFixes as PauseAnswer,
  };
  if (typeof r.url === "string") report.url = r.url;
  return { ok: true, report };
}

const CATEGORY_TITLES: Record<ReportCategory, string> = {
  ads: "Ads still showing",
  broken: "Site broken",
  cookie: "Cookie banner still showing",
  other: "Problem",
};

export function reportTitle(report: ProblemReport): string {
  return `${CATEGORY_TITLES[report.category]} on ${report.hostname}`;
}

/** The report as the person reads it before sending: one "Label: value"
 * line per field, the same content formatReport files. */
export function reportLines(report: ProblemReport): string {
  return [
    `What's wrong: ${CATEGORY_TITLES[report.category]}`,
    `Site: ${report.hostname}`,
    ...(report.url ? [`Page: ${report.url}`] : []),
    `Does pausing Moat fix it: ${{ yes: "Yes", no: "No", untried: "Not tried" }[report.pausingFixes]}`,
    `Moat: ${report.moatVersion} on ${report.browser}, level ${report.level}`,
    `Lists on: ${report.lists.length ? report.lists.join(", ") : "none"}`,
    `Note: ${report.note.trim() || "(none)"}`,
  ].join("\n");
}

/** The report as plain text: the page's "Copy report" and GitHub fallback,
 * and the body of the filed issue. The person's note goes in a fenced block
 * so nothing in it renders as a link, image, mention or heading. */
export function formatReport(report: ProblemReport): string {
  const note = report.note.trim() ? report.note.replace(/`{3,}/g, "``") : "(no note)";
  return [
    `**What's wrong:** ${CATEGORY_TITLES[report.category]}`,
    `**Site:** ${report.hostname}`,
    ...(report.url ? [`**Page:** \`${report.url.replace(/`/g, "%60")}\``] : []),
    `**Does pausing Moat fix it:** ${{ yes: "Yes", no: "No", untried: "Not tried" }[report.pausingFixes]}`,
    `**Moat:** ${report.moatVersion} on ${report.browser}, level \`${report.level}\``,
    `**Lists on:** ${report.lists.length ? report.lists.join(", ") : "none"}`,
    "",
    "**Note:**",
    "```text",
    note,
    "```",
  ].join("\n");
}

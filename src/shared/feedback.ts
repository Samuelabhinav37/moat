// The two short answers Moat can send besides a problem report, shared by
// what sends them and the report service (report-worker/), which checks
// them again before filing:
//   - the check-in: one question in the popup after Moat has been in use a
//     while (popup/checkinCard.ts), "How is Moat working for you?"
//   - the goodbye: one question on samuelabhinav.com/moat/goodbye/, which
//     the browser opens after Moat is removed.
// Neither carries a site, an address or anything about browsing.

export const FEEDBACK_VERSION = 1;
export const MAX_FEEDBACK_NOTE = 1000;

export const CHECKIN_SCORES = ["great", "okay", "poor"] as const;
export type CheckinScore = (typeof CHECKIN_SCORES)[number];

export const GOODBYE_REASONS = ["broke-sites", "missed-ads", "slow", "switched", "other"] as const;
export type GoodbyeReason = (typeof GOODBYE_REASONS)[number];

export interface Checkin {
  v: typeof FEEDBACK_VERSION;
  score: CheckinScore;
  note: string;
  moatVersion: string;
  /** e.g. "Chrome 141". */
  browser: string;
  /** Whole weeks since Moat was installed, so answers can be read by how long people have used it. */
  weeksSinceInstall: number;
}

export interface Goodbye {
  v: typeof FEEDBACK_VERSION;
  reason: GoodbyeReason;
  note: string;
  /** The version that was removed, from the page's address; "" when missing. */
  moatVersion: string;
}

const VERSION = /^\d+(?:\.\d+){1,3}$/;
const BROWSER = /^(?:Chrome|Chromium|Edge|Brave|Opera|Firefox|Other)(?: \d{1,4})?$/;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isObject = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input);
const goodNote = (note: unknown): note is string => typeof note === "string" && note.length <= MAX_FEEDBACK_NOTE;

export function validateCheckin(input: unknown): Result<Checkin> {
  if (!isObject(input)) return { ok: false, error: "not an object" };
  if (input.v !== FEEDBACK_VERSION) return { ok: false, error: "unknown version" };
  if (!(CHECKIN_SCORES as readonly unknown[]).includes(input.score)) return { ok: false, error: "score" };
  if (!goodNote(input.note)) return { ok: false, error: "note" };
  if (typeof input.moatVersion !== "string" || !VERSION.test(input.moatVersion)) return { ok: false, error: "moatVersion" };
  if (typeof input.browser !== "string" || !BROWSER.test(input.browser)) return { ok: false, error: "browser" };
  const weeks = input.weeksSinceInstall;
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 0 || weeks > 520) return { ok: false, error: "weeksSinceInstall" };
  return { ok: true, value: { v: FEEDBACK_VERSION, score: input.score as CheckinScore, note: input.note.trim(), moatVersion: input.moatVersion, browser: input.browser, weeksSinceInstall: weeks } };
}

export function validateGoodbye(input: unknown): Result<Goodbye> {
  if (!isObject(input)) return { ok: false, error: "not an object" };
  if (input.v !== FEEDBACK_VERSION) return { ok: false, error: "unknown version" };
  if (!(GOODBYE_REASONS as readonly unknown[]).includes(input.reason)) return { ok: false, error: "reason" };
  if (!goodNote(input.note)) return { ok: false, error: "note" };
  if (typeof input.moatVersion !== "string" || (input.moatVersion !== "" && !VERSION.test(input.moatVersion))) return { ok: false, error: "moatVersion" };
  return { ok: true, value: { v: FEEDBACK_VERSION, reason: input.reason as GoodbyeReason, note: input.note.trim(), moatVersion: input.moatVersion } };
}

const SCORE_TEXT: Record<CheckinScore, string> = { great: "Great", okay: "Okay", poor: "Not well" };
const REASON_TEXT: Record<GoodbyeReason, string> = {
  "broke-sites": "It broke sites",
  "missed-ads": "It missed ads",
  slow: "It slowed my browser",
  switched: "Switched to another blocker",
  other: "Something else",
};

/** A fenced block so nothing in a note renders as a link, mention or heading. */
const fenced = (note: string) => (note ? ["```text", note.replace(/`{3,}/g, "``"), "```"] : []);

export function formatCheckin(c: Checkin): string {
  return [`**${SCORE_TEXT[c.score]}** · Moat ${c.moatVersion} on ${c.browser} · week ${c.weeksSinceInstall}`, ...fenced(c.note)].join("\n");
}

export function formatGoodbye(g: Goodbye): string {
  return [`**${REASON_TEXT[g.reason]}** · Moat ${g.moatVersion || "version unknown"}`, ...fenced(g.note)].join("\n");
}

/** The ISO week a date falls in, like "2026-W42": the weekly issue each answer joins. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

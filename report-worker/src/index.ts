// Moat's report service: a Cloudflare Worker that receives a problem report
// from Moat's report page (src/report/report.ts), checks it with the same
// schema the page used (src/shared/problemReport.ts), and files it as an
// issue in the private moat-reports repository. A second report for the same
// site and problem adds a comment to the open issue instead of a new one.
//
// Two short answers come in the same way (src/shared/feedback.ts): the
// popup's check-in (POST /checkin, from Moat itself) and the uninstall page's
// one question (POST /goodbye, from samuelabhinav.com/moat/goodbye/). Each
// joins one issue per ISO week, "Check-ins 2026-W42" and "Goodbyes 2026-W42".
//
// What it keeps: one number, how many reports it filed today (DailyCap
// below), so a flood can't run through the GitHub token's limits or fill
// the repository. No logs (observability is off in wrangler.toml), nothing
// about the sender. The caller's IP address is only passed to the rate
// limiter as a key and never written anywhere by this code.
import { formatReport, reportTitle, validateReport, type ProblemReport } from "../../src/shared/problemReport";
import { formatCheckin, formatGoodbye, isoWeek, validateCheckin, validateGoodbye } from "../../src/shared/feedback";

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The parts of a Durable Object namespace this file uses. */
export interface CapNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string): Promise<Response> };
}

export interface Env {
  /** Fine-grained token: Issues read/write on REPORTS_REPO only. A secret. */
  GITHUB_TOKEN: string;
  /** "owner/name" of the private repository reports are filed in. */
  REPORTS_REPO: string;
  /** Per-IP limit: a few reports a minute. */
  IP_LIMITER: RateLimiter;
  /** Per site and problem: stops one site being flooded. */
  SITE_LIMITER: RateLimiter;
  /** Everyone together, per Cloudflare location: a burst from many IPs. */
  ALL_LIMITER: RateLimiter;
  /** One DailyCap counter for the whole service. */
  DAILY_CAP: CapNamespace;
  /** Reports filed per UTC day before the service answers "busy". */
  DAILY_REPORT_LIMIT: string;
  /** Check-ins and goodbyes together, per UTC day. */
  DAILY_FEEDBACK_LIMIT?: string;
}

/** Counts reports per UTC day across every Cloudflare location (one
 * Durable Object, so the count is exact). Keeps only today's number. */
export class DailyCap {
  constructor(private readonly state: { storage: { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<boolean> } }) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const day = url.searchParams.get("day") ?? "";
    const limit = Number(url.searchParams.get("limit"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(limit)) return Response.json({ ok: false }, { status: 400 });
    // Storage calls in one Durable Object don't interleave, so this
    // read-then-write can't double-count.
    const previous = await this.state.storage.get("day");
    if (previous !== day) {
      await this.state.storage.put("day", day);
      await this.state.storage.put("count", 0);
    }
    const count = Number((await this.state.storage.get("count")) ?? 0);
    if (count >= limit) return Response.json({ ok: false });
    await this.state.storage.put("count", count + 1);
    return Response.json({ ok: true });
  }
}

const DEFAULT_DAILY_LIMIT = 150;
const DEFAULT_FEEDBACK_LIMIT = 300;

/** Takes one of today's slots ("reports", or "feedback" for check-ins and
 * goodbyes); false when they're used up. */
async function takeDailySlot(env: Env, now: Date, counter: "reports" | "feedback" = "reports"): Promise<boolean> {
  const limit = counter === "reports" ? Number(env.DAILY_REPORT_LIMIT) || DEFAULT_DAILY_LIMIT : Number(env.DAILY_FEEDBACK_LIMIT) || DEFAULT_FEEDBACK_LIMIT;
  const stub = env.DAILY_CAP.get(env.DAILY_CAP.idFromName(counter));
  const res = await stub.fetch(`https://daily-cap/take?day=${now.toISOString().slice(0, 10)}&limit=${limit}`);
  return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
}

const MAX_BODY_BYTES = 16 * 1024;
// Only Moat's own extension pages send reports and check-ins.
const EXTENSION_ORIGIN = /^(?:chrome-extension|moz-extension):\/\/[a-z0-9-]{1,64}$/;
// The uninstall page is a web page: only Moat's own site may send goodbyes.
const SITE_ORIGIN = "https://samuelabhinav.com";

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-moat-report",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

/** GitHub labels are at most 50 characters. */
const label = (value: string) => value.slice(0, 50);

export function labelsFor(report: ProblemReport): string[] {
  return [
    label(`type:${report.category}`),
    label(`site:${report.hostname}`),
    label(`v:${report.moatVersion}`),
    label(`browser:${report.browser.split(" ")[0]!.toLowerCase()}`),
  ];
}

async function github(env: Env, fetchImpl: typeof fetch, path: string, init: RequestInit = {}): Promise<Response> {
  return fetchImpl(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "moat-report-worker",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
}

/** Files the report: a comment on the matching open issue, or a new issue.
 * Returns the issue number. */
export async function fileReport(report: ProblemReport, env: Env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const [typeLabel, siteLabel] = labelsFor(report);
  const query = `repo:${env.REPORTS_REPO} is:issue is:open label:"${typeLabel}" label:"${siteLabel}"`;
  const search = await github(env, fetchImpl, `/search/issues?q=${encodeURIComponent(query)}&per_page=1`);
  if (search.ok) {
    const found = (await search.json()) as { items?: { number: number }[] };
    const existing = found.items?.[0]?.number;
    if (existing) {
      const comment = await github(env, fetchImpl, `/repos/${env.REPORTS_REPO}/issues/${existing}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: `Another report for this.\n\n${formatReport(report)}` }),
      });
      if (!comment.ok) throw new Error(`comment ${comment.status}`);
      return existing;
    }
  }
  const created = await github(env, fetchImpl, `/repos/${env.REPORTS_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: reportTitle(report), body: formatReport(report), labels: labelsFor(report) }),
  });
  if (!created.ok) throw new Error(`create ${created.status}`);
  return ((await created.json()) as { number: number }).number;
}

const WEEKLY = {
  checkin: { title: "Check-ins", label: "checkin" },
  goodbye: { title: "Goodbyes", label: "goodbye" },
} as const;

/** Adds an answer to this week's issue for its kind, opening the issue the
 * first time. Returns the issue number. */
export async function fileWeekly(kind: keyof typeof WEEKLY, text: string, env: Env, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<number> {
  const week = isoWeek(now);
  const { title, label: kindLabel } = WEEKLY[kind];
  const weekLabel = label(`${kindLabel}:${week}`);
  const query = `repo:${env.REPORTS_REPO} is:issue label:"${weekLabel}"`;
  const search = await github(env, fetchImpl, `/search/issues?q=${encodeURIComponent(query)}&per_page=1`);
  if (search.ok) {
    const existing = ((await search.json()) as { items?: { number: number }[] }).items?.[0]?.number;
    if (existing) {
      const comment = await github(env, fetchImpl, `/repos/${env.REPORTS_REPO}/issues/${existing}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
      if (!comment.ok) throw new Error(`comment ${comment.status}`);
      return existing;
    }
  }
  const created = await github(env, fetchImpl, `/repos/${env.REPORTS_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: `${title} ${week}`, body: text, labels: [kindLabel, weekLabel] }),
  });
  if (!created.ok) throw new Error(`create ${created.status}`);
  return ((await created.json()) as { number: number }).number;
}

export async function handle(request: Request, env: Env, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  if (path === "/checkin" || path === "/goodbye") return handleFeedback(path === "/checkin" ? "checkin" : "goodbye", request, env, fetchImpl, now);
  const origin = request.headers.get("origin");
  const allowed = origin !== null && EXTENSION_ORIGIN.test(origin) ? origin : null;
  if (request.method === "OPTIONS") {
    return allowed ? new Response(null, { status: 204, headers: corsHeaders(allowed) }) : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json({ error: "method" }, 405, allowed);
  if (!allowed || request.headers.get("x-moat-report") !== "1") return json({ error: "origin" }, 403, allowed);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "too large" }, 413, allowed);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "too large" }, 413, allowed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "json" }, 400, allowed);
  }
  const result = validateReport(parsed);
  if (!result.ok) return json({ error: result.error }, 400, allowed);
  const report = result.report;

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await env.IP_LIMITER.limit({ key: `ip:${ip}` })).success) return json({ error: "busy" }, 429, allowed);
  if (!(await env.SITE_LIMITER.limit({ key: `site:${report.hostname}:${report.category}` })).success) return json({ error: "busy" }, 429, allowed);
  if (!(await env.ALL_LIMITER.limit({ key: "all" })).success) return json({ error: "busy" }, 429, allowed);
  if (!(await takeDailySlot(env, now))) return json({ error: "busy" }, 429, allowed);

  try {
    const number = await fileReport(report, env, fetchImpl);
    return json({ id: `R-${number}` }, 200, allowed);
  } catch {
    return json({ error: "upstream" }, 502, allowed);
  }
}

/** POST /checkin (from Moat's popup) and POST /goodbye (from the uninstall
 * page). The same checks as a report: origin, header, size, schema, rate
 * limits, a daily cap. */
async function handleFeedback(kind: "checkin" | "goodbye", request: Request, env: Env, fetchImpl: typeof fetch, now: Date): Promise<Response> {
  const origin = request.headers.get("origin");
  const allowed = origin !== null && (kind === "checkin" ? EXTENSION_ORIGIN.test(origin) : origin === SITE_ORIGIN) ? origin : null;
  if (request.method === "OPTIONS") {
    return allowed ? new Response(null, { status: 204, headers: corsHeaders(allowed) }) : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json({ error: "method" }, 405, allowed);
  if (!allowed || request.headers.get("x-moat-report") !== "1") return json({ error: "origin" }, 403, allowed);
  const text = await request.text();
  if (text.length > 4096) return json({ error: "too large" }, 413, allowed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "json" }, 400, allowed);
  }
  const checked = kind === "checkin" ? validateCheckin(parsed) : validateGoodbye(parsed);
  if (!checked.ok) return json({ error: checked.error }, 400, allowed);
  const formatted = "score" in checked.value ? formatCheckin(checked.value) : formatGoodbye(checked.value);

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await env.IP_LIMITER.limit({ key: `ip:${ip}` })).success) return json({ error: "busy" }, 429, allowed);
  if (!(await env.ALL_LIMITER.limit({ key: "all" })).success) return json({ error: "busy" }, 429, allowed);
  if (!(await takeDailySlot(env, now, "feedback"))) return json({ error: "busy" }, 429, allowed);

  try {
    await fileWeekly(kind, formatted, env, fetchImpl, now);
    return json({ ok: true }, 200, allowed);
  } catch {
    return json({ error: "upstream" }, 502, allowed);
  }
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};

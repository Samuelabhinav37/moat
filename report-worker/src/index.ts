// Moat's report service: a Cloudflare Worker that receives a problem report
// from Moat's report page (src/report/report.ts), checks it with the same
// schema the page used (src/shared/problemReport.ts), and files it as an
// issue in the private moat-reports repository. A second report for the same
// site and problem adds a comment to the open issue instead of a new one.
//
// What it keeps: nothing. No logs (observability is off in wrangler.toml),
// no storage. The caller's IP address is only passed to the rate limiter as
// a key and never written anywhere by this code.
import { formatReport, reportTitle, validateReport, type ProblemReport } from "../../src/shared/problemReport";

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
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
}

const MAX_BODY_BYTES = 16 * 1024;
// Only Moat's own extension pages send reports.
const EXTENSION_ORIGIN = /^(?:chrome-extension|moz-extension):\/\/[a-z0-9-]{1,64}$/;

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

export async function handle(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
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

  try {
    const number = await fileReport(report, env, fetchImpl);
    return json({ id: `R-${number}` }, 200, allowed);
  } catch {
    return json({ error: "upstream" }, 502, allowed);
  }
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
};

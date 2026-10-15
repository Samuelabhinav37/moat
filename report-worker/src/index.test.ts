import { describe, expect, it, vi } from "vitest";
import type { ProblemReport } from "../../src/shared/problemReport";
import { DailyCap, handle, labelsFor, type CapNamespace, type Env } from "./index";

const report: ProblemReport = {
  v: 1,
  category: "ads",
  hostname: "news.example.com",
  note: "Banner above the story",
  moatVersion: "0.11.164",
  browser: "Chrome 141",
  level: "standard",
  lists: ["Ads filter"],
  pausingFixes: "untried",
};

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const allow = { limit: async () => ({ success: true }) };
const deny = { limit: async () => ({ success: false }) };

/** A Durable Object namespace holding one real DailyCap over in-memory storage. */
function fakeCap(): CapNamespace {
  const data = new Map<string, unknown>();
  const cap = new DailyCap({
    storage: {
      get: async (k) => data.get(k),
      put: async (k, v) => void data.set(k, v),
      delete: async (k) => data.delete(k),
    },
  });
  return { idFromName: (n) => n, get: () => ({ fetch: (input) => cap.fetch(new Request(input)) }) };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    GITHUB_TOKEN: "t",
    REPORTS_REPO: "owner/moat-reports",
    IP_LIMITER: allow,
    SITE_LIMITER: allow,
    ALL_LIMITER: allow,
    DAILY_CAP: fakeCap(),
    DAILY_REPORT_LIMIT: "150",
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://moat-reports.example.workers.dev/", {
    method: "POST",
    headers: { origin: ORIGIN, "x-moat-report": "1", "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A fake GitHub: search finds `existing` (or nothing), creates issue 42. */
function fakeGithub(existing?: number) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.includes("/search/issues")) return Response.json({ items: existing ? [{ number: existing }] : [] });
    if (u.endsWith("/comments")) return Response.json({ id: 1 }, { status: 201 });
    if (u.endsWith("/issues")) return Response.json({ number: 42 }, { status: 201 });
    return new Response("nope", { status: 404 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("report service", () => {
  it("files a new issue with labels and answers with a reference", async () => {
    const gh = fakeGithub();
    const res = await handle(post(report), env(), gh.impl);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "R-42" });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const create = gh.calls.find((c) => c.method === "POST")!;
    expect(create.url).toBe("https://api.github.com/repos/owner/moat-reports/issues");
    expect(create.body).toMatchObject({ title: "Ads still showing on news.example.com", labels: ["type:ads", "site:news.example.com", "v:0.11.164", "browser:chrome"] });
  });

  it("adds a comment to the open issue for the same site and problem", async () => {
    const gh = fakeGithub(7);
    const res = await handle(post(report), env(), gh.impl);
    expect(await res.json()).toEqual({ id: "R-7" });
    expect(gh.calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["https://api.github.com/repos/owner/moat-reports/issues/7/comments"]);
  });

  it("never sends the caller's IP address to GitHub", async () => {
    const gh = fakeGithub();
    await handle(post(report), env(), gh.impl);
    expect(JSON.stringify(gh.calls)).not.toContain("203.0.113.7");
  });

  it("answers the preflight only for extension pages", async () => {
    const ok = await handle(new Request("https://x/", { method: "OPTIONS", headers: { origin: ORIGIN } }), env());
    expect(ok.status).toBe(204);
    const web = await handle(new Request("https://x/", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), env());
    expect(web.status).toBe(403);
  });

  it("refuses web pages, missing headers, junk and bad reports", async () => {
    const gh = fakeGithub();
    expect((await handle(post(report, { origin: "https://evil.example" }), env(), gh.impl)).status).toBe(403);
    expect((await handle(post(report, { "x-moat-report": "" }), env(), gh.impl)).status).toBe(403);
    expect((await handle(post("{not json"), env(), gh.impl)).status).toBe(400);
    const bad = await handle(post({ ...report, hostname: "evil.example/../x" }), env(), gh.impl);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "hostname" });
    expect((await handle(post("x".repeat(20_000)), env(), gh.impl)).status).toBe(413);
    expect(gh.calls).toHaveLength(0);
  });

  it("returns 429 when either limiter says no, before touching GitHub", async () => {
    const gh = fakeGithub();
    expect((await handle(post(report), env({ IP_LIMITER: deny }), gh.impl)).status).toBe(429);
    expect((await handle(post(report), env({ SITE_LIMITER: deny }), gh.impl)).status).toBe(429);
    expect(gh.calls).toHaveLength(0);
  });

  it("returns 502 when GitHub fails", async () => {
    const failing = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    expect((await handle(post(report), env(), failing)).status).toBe(502);
  });

  it("keeps labels within GitHub's 50-character limit", () => {
    const long = { ...report, hostname: `${"a".repeat(60)}.example.com` };
    for (const l of labelsFor(long)) expect(l.length).toBeLessThanOrEqual(50);
  });

  it("answers busy once today's reports are used up, and starts again tomorrow", async () => {
    const e = env({ DAILY_REPORT_LIMIT: "2" });
    const day = new Date("2026-10-08T12:00:00Z");
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await handle(post(report), e, fakeGithub().impl, day)).status);
    expect(statuses).toEqual([200, 200, 429]);
    expect((await handle(post(report), e, fakeGithub().impl, new Date("2026-10-09T00:00:01Z"))).status).toBe(200);
  });

  it("answers busy when everyone together is over the per-minute limit", async () => {
    const gh = fakeGithub();
    const res = await handle(post(report), env({ ALL_LIMITER: deny }), gh.impl);
    expect(res.status).toBe(429);
    expect(gh.calls).toHaveLength(0);
  });
});

describe("check-ins and goodbyes", () => {
  const checkin = { v: 1, score: "great", note: "Quiet and fast.", moatVersion: "0.11.287", browser: "Chrome 141", weeksSinceInstall: 2 };
  const goodbye = { v: 1, reason: "switched", note: "", moatVersion: "0.11.287" };
  const NOW = new Date(Date.UTC(2026, 9, 15));
  const to = (path: string, body: unknown, origin: string) =>
    new Request(`https://moat-reports.example.workers.dev${path}`, {
      method: "POST",
      headers: { origin, "x-moat-report": "1", "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify(body),
    });

  it("opens this week's check-in issue for the first answer", async () => {
    const gh = fakeGithub();
    const res = await handle(to("/checkin", checkin, ORIGIN), env(), gh.impl, NOW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const create = gh.calls.find((c) => c.method === "POST")!;
    expect(create.body).toEqual({ title: "Check-ins 2026-W42", body: "**Great** · Moat 0.11.287 on Chrome 141 · week 2\n```text\nQuiet and fast.\n```", labels: ["checkin", "checkin:2026-W42"] });
  });

  it("adds later answers to the same issue", async () => {
    const gh = fakeGithub(9);
    await handle(to("/checkin", checkin, ORIGIN), env(), gh.impl, NOW);
    expect(gh.calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["https://api.github.com/repos/owner/moat-reports/issues/9/comments"]);
  });

  it("takes check-ins only from Moat and goodbyes only from samuelabhinav.com", async () => {
    const gh = fakeGithub();
    expect((await handle(to("/checkin", checkin, "https://samuelabhinav.com"), env(), gh.impl, NOW)).status).toBe(403);
    expect((await handle(to("/goodbye", goodbye, ORIGIN), env(), gh.impl, NOW)).status).toBe(403);
    expect((await handle(to("/goodbye", goodbye, "https://evil.example"), env(), gh.impl, NOW)).status).toBe(403);
    const ok = await handle(to("/goodbye", goodbye, "https://samuelabhinav.com"), env(), gh.impl, NOW);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://samuelabhinav.com");
    expect(gh.calls.find((c) => c.method === "POST")!.body).toMatchObject({ title: "Goodbyes 2026-W42", labels: ["goodbye", "goodbye:2026-W42"] });
  });

  it("answers the goodbye page's preflight", async () => {
    const res = await handle(new Request("https://moat-reports.example.workers.dev/goodbye", { method: "OPTIONS", headers: { origin: "https://samuelabhinav.com" } }), env());
    expect(res.status).toBe(204);
  });

  it("rejects bad answers and stops at the daily cap", async () => {
    const gh = fakeGithub();
    expect((await handle(to("/checkin", { ...checkin, score: "10/10" }, ORIGIN), env(), gh.impl, NOW)).status).toBe(400);
    const capped = env({ DAILY_FEEDBACK_LIMIT: "1" });
    expect((await handle(to("/checkin", checkin, ORIGIN), capped, gh.impl, NOW)).status).toBe(200);
    expect((await handle(to("/checkin", checkin, ORIGIN), capped, gh.impl, NOW)).status).toBe(429);
    expect((await handle(post(report), capped, gh.impl, NOW)).status).toBe(200);
  });
});

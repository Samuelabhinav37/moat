import { describe, expect, it } from "vitest";
import { MAX_BLOCKED_HOSTS, formatReport, reportLines, topBlockedHosts, validateReport, type ProblemReport } from "./problemReport";
import { buildReport } from "../report/reportForm";
import { sendReport } from "../report/sendReport";

const good: ProblemReport = {
  v: 1,
  category: "broken",
  hostname: "news.example.com",
  note: "",
  moatVersion: "0.11.286",
  browser: "Chrome 141",
  level: "standard",
  lists: [],
  pausingFixes: "untried",
};

describe("blocked addresses in a report", () => {
  it("accepts real host names and keeps them", () => {
    const r = validateReport({ ...good, blockedHosts: ["ads.example.net", "cdn.tracker.io"] });
    expect(r.ok && r.report.blockedHosts).toEqual(["ads.example.net", "cdn.tracker.io"]);
  });

  it("rejects paths, addresses with a scheme, markdown and too many", () => {
    for (const bad of [["ads.example.net/pixel"], ["https://ads.example.net"], ["[x](y)"], ["@someone"], "ads.example.net", Array.from({ length: MAX_BLOCKED_HOSTS + 1 }, (_, i) => `h${i}.example.com`)]) {
      expect(validateReport({ ...good, blockedHosts: bad }).ok, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });

  it("drops an empty list instead of sending it", () => {
    const r = validateReport({ ...good, blockedHosts: [] });
    expect(r.ok && "blockedHosts" in r.report).toBe(false);
  });

  it("orders the page's hosts by how much was blocked, real host names only, at most 30", () => {
    const counts = new Map<string, number>([["b.example.com", 2], ["a.example.com", 2], ["big.example.com", 9], ["not a host", 50]]);
    for (let i = 0; i < 40; i++) counts.set(`x${i}.example.org`, 1);
    const top = topBlockedHosts(counts);
    expect(top.slice(0, 3)).toEqual(["big.example.com", "a.example.com", "b.example.com"]);
    expect(top).toHaveLength(MAX_BLOCKED_HOSTS);
    expect(top).not.toContain("not a host");
  });

  it("is sent only when the box stays ticked", () => {
    const form = { category: "ads" as const, hostname: "news.example.com", pageUrl: null, includeUrl: false, note: "", pausingFixes: "untried" as const, blockedHosts: ["ads.example.net"] };
    const env = { moatVersion: "0.11.286", browser: "Chrome 141", level: "standard", lists: [] };
    expect(buildReport({ ...form, includeBlocked: true }, env).blockedHosts).toEqual(["ads.example.net"]);
    expect(buildReport({ ...form, includeBlocked: false }, env).blockedHosts).toBeUndefined();
  });

  it("shows them in the preview and files them folded away, one per line", () => {
    const report = { ...good, blockedHosts: ["ads.example.net", "cdn.tracker.io"] };
    expect(reportLines(report)).toContain("Blocked on this page: ads.example.net, cdn.tracker.io");
    expect(formatReport(report)).toContain("<details><summary>Blocked on this page (2)</summary>\n\n```text\nads.example.net\ncdn.tracker.io\n```");
    expect(formatReport(good)).not.toContain("Blocked on this page");
  });
});

describe("sendReport", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the reference", async () => {
    await expect(sendReport(good, reply(200, { id: "R-42" }))).resolves.toBe("R-42");
  });

  it("says busy when the service is rate limiting", async () => {
    await expect(sendReport(good, reply(429, {}))).rejects.toThrow("busy");
  });

  it("fails without a reference", async () => {
    await expect(sendReport(good, reply(200, {}))).rejects.toThrow();
  });
});

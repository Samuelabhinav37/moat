import { describe, expect, it } from "vitest";
import { buildIssueUrl } from "./reportIssue";

describe("buildIssueUrl", () => {
  it("includes the hostname and enabled filter groups in the issue body", () => {
    const url = buildIssueUrl({ hostname: "example.com", enabledFilterGroups: ["AdGuard Base filter", "Trackers"] }, "0.11.4");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://github.com/Samuelabhinav37/moat/issues/new");
    expect(parsed.searchParams.get("title")).toBe("Problem on example.com");
    const body = parsed.searchParams.get("body")!;
    expect(body).toContain("Site: example.com");
    expect(body).toContain("Enabled filter groups: AdGuard Base filter, Trackers");
    expect(body).toContain("Moat version: 0.11.4");
  });

  it("falls back to a generic title and body note when hostname is empty", () => {
    const url = buildIssueUrl({ hostname: "", enabledFilterGroups: [] }, "0.11.4");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("title")).toBe("Problem on a site");
    const body = parsed.searchParams.get("body")!;
    expect(body).toContain("(none -- reported from a page with no hostname)");
    expect(body).toContain("Enabled filter groups: none");
  });

  it("never includes a full URL, only the hostname", () => {
    const url = buildIssueUrl({ hostname: "example.com", enabledFilterGroups: [] }, "0.11.4");
    const body = new URL(url).searchParams.get("body")!;
    expect(body).not.toContain("http://");
    expect(body).not.toContain("https://example.com");
  });
});

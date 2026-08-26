import type { ReportContextResponse } from "../types";

const REPO_URL = "https://github.com/Samuelabhinav37/moat";

/** Builds a pre-filled "new issue" URL against Moat's own repo -- hostname
 * only (never the full URL, see ReportContextResponse's doc comment) plus
 * the filter groups that were enabled globally, so a report carries enough
 * context to be actionable without the reporter needing to know what a
 * "ruleset" is. */
export function buildIssueUrl(context: ReportContextResponse, version: string): string {
  const title = `Problem on ${context.hostname || "a site"}`;
  const groups = context.enabledFilterGroups.length > 0 ? context.enabledFilterGroups.join(", ") : "none";
  const body = [
    `Site: ${context.hostname || "(none -- reported from a page with no hostname)"}`,
    `Enabled filter groups: ${groups}`,
    `Moat version: ${version}`,
    "",
    "Describe the problem:",
    "",
  ].join("\n");

  const params = new URLSearchParams({ title, body });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

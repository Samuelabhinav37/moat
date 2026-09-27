// Where the report page sends problem reports: Moat's small report service
// (report-worker/, a Cloudflare Worker that files each report as an issue in
// a private repository). Empty until that service is deployed; the report
// page then offers "Copy report" and GitHub instead of Send.
// Set by scripts/report-setup-wizard.sh.
export const REPORT_ENDPOINT = "";

/** The public issue tracker, for anyone who prefers it or when sending fails. */
export const REPORT_GITHUB_NEW_ISSUE = "https://github.com/Samuelabhinav37/moat/issues/new";

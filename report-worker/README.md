# moat-reports: Moat's report service

A Cloudflare Worker that receives problem reports from Moat's report page
(`src/report/`) and files each one as an issue in the private
`Samuelabhinav37/moat-reports` repository. A second report for the same site
and problem becomes a comment on the open issue.

- **Checks:** the same schema the page uses (`src/shared/problemReport.ts`),
  requests only from extension pages with the `x-moat-report` header, bodies
  up to 16 KB.
- **Limits:** 5 reports a minute per IP address and 20 a minute per site and
  problem, counted per Cloudflare location (`wrangler.toml`).
- **Keeps nothing:** no logs or traces (`observability` off), no storage. The
  IP address is only a rate-limiter key and is never sent to GitHub.
- **Token:** a fine-grained GitHub token with Issues read and write on the
  reports repository only, stored as the `GITHUB_TOKEN` secret.

Set up and deploy with `scripts/report-setup-wizard.sh`. Tests run with the
rest of the repository (`npm test`).

# moat-reports: Moat's report service

A Cloudflare Worker that receives problem reports from Moat's report page
(`src/report/`) and files each one as an issue in the private
`Samuelabhinav37/moat-reports` repository. A second report for the same site
and problem becomes a comment on the open issue.

- **Checks:** the same schema the page uses (`src/shared/problemReport.ts`),
  requests only from extension pages with the `x-moat-report` header, bodies
  up to 16 KB.
- **Limits:** 5 reports a minute per IP address, 20 a minute per site and
  problem, and 30 a minute for everyone together, counted per Cloudflare
  location (`wrangler.toml`). On top of those, at most `DAILY_REPORT_LIMIT`
  (150) reports a UTC day in total, counted exactly by one Durable Object
  (`DailyCap`). The origin check only stops browsers, so these limits are
  what bound a scripted flood: it can't run past the day's cap or the
  GitHub token's API limits.
- **Keeps almost nothing:** no logs or traces (`observability` off). It
  stores today's report count, and per site and problem (`ReportTally`),
  HMAC hashes of the last 7 days' reporters' IP addresses under a random
  key kept only there. An alarm deletes the hashes and the key 7 days after
  the last report. The IP address itself is a rate-limiter key and a hash
  input, never stored as is and never sent to GitHub.
- **Report threshold:** when 3 different reporters send the same site and
  problem within 7 days, the issue gets the `threshold:3-reporters` label and
  a comment with a draft `live/site-exceptions.json` entry for a broken site or
  a cookie banner. Nothing ships until a person adds it (docs/site-exceptions.md).
- **Deploying this version** creates the `DailyCap` and `ReportTally`
  Durable Objects (migrations `v1` and `v2` in `wrangler.toml`) and needs
  nothing else set.
- **Token:** a fine-grained GitHub token with Issues read and write on the
  reports repository only, stored as the `GITHUB_TOKEN` secret.

Set up and deploy with `scripts/report-setup-wizard.sh`. Tests run with the
rest of the repository (`npm test`).

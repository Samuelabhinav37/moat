# Research docs: convention

Everything in this directory is a **point-in-time snapshot**, dated in its title or
intro. Treat it that way when reading it:

- A claim about **another tool's** architecture (uBO, AdGuard, Ghostery, Brave, ...)
  doesn't go stale just because Moat's own code changes later. Leave those alone.
- A claim about **Moat's own** code is only as good as the day it was verified. If
  you're reading one of these docs to inform new work and find a claim about Moat's
  own state disproven by the current source, **correct it in place with a dated
  note** (e.g. `> **Corrected 2026-09-12: ...**`) rather than leaving it silently
  wrong or deleting the doc. Keep the original text nearby (struck through or quoted)
  so the historical reasoning stays legible — these docs are also a record of *why*
  a decision was made, not just *what* was concluded.
- If an entire doc's core premise has shipped or been overtaken, prepend a clear
  "SUPERSEDED" notice at the top rather than editing every paragraph — see
  `blocking-algorithm-cost-and-parallelism-2026-09.md` for the pattern.

This convention exists because three docs in this directory (
`blocking-algorithm-cost-and-parallelism-2026-09.md`,
`code-quality-audit.md`, `ad-blocker-architecture-and-roadmap.md`) were each found,
during a 2026-09-12 algorithm audit, to contain claims about Moat's own code that
were already wrong — in one case, wrong on the day the doc was written. Silent
staleness in these docs previously fed directly into a bad implementation plan
(see `redirect-resources-and-cname-list-adoption-2026-09.md`, which caught two of
the audit's own recommendations recommending already-shipped work). Dated
corrections in place are cheaper than that.

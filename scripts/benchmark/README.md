# Benchmark

Compares Moat with other blockers in real Chrome, and stress-tests Moat. Not part of CI: the
benchmark loads live sites (numbers move day to day) and takes about 25 minutes.

```sh
npm run build
node scripts/benchmark/fetch-competitors.mjs   # uBO Lite, AdGuard, Ghostery, ABP + d3ward host list
node scripts/benchmark/bench.mjs               # or: bench.mjs moat,ubol
node scripts/benchmark/stress.mjs              # Moat only, local pages, ~5 minutes
```

Everything lands in the gitignored `.cache/benchmark/`: competitor packages, `bench-results.json`,
`stress-results.json`. Chrome for Testing comes from `scripts/chrome-for-testing.mjs`.

What `bench.mjs` measures, per blocker at its own defaults in a fresh profile:
- **d3ward's 131 hosts** (ads, analytics, error trackers, social, mixed, phone telemetry): which ones
  Chrome refuses (`ERR_BLOCKED_BY_CLIENT`).
- **Eight ad-heavy sites**: requests, blocked requests, bytes, first paint, LCP, main-thread time,
  visible ad slots left (visible third-party frames plus visible ad-named containers, a proxy), and
  visible cookie banners (only meaningful from an EU connection).
- **Cloudflare Turnstile** with Cloudflare's always-pass test key, 3 attempts.
- **cnn.com**: blocked requests in 15 seconds (catches retry loops).
- **Worker memory and startup time.**

Ghostery blocks nothing until its onboarding is accepted, so the script clicks "Continue" for it.

The first full run is written up in `docs/research/test-audit-2026-09.md`.

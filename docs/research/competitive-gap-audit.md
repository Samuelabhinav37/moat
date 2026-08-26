# Competitive gap audit: Moat vs. uBlock Origin, AdGuard, Brave Shields, Ghostery, Privacy Badger, DuckDuckGo Privacy Essentials

A fresh, broader pass than [`simplicity-and-completeness-review.md`](simplicity-and-completeness-review.md)
(accessibility/onboarding/portability, already solved) and
[`clearurls-gap-audit.md`](clearurls-gap-audit.md) (one specific feature vs. one specific
competitor, already solved). This doc asks the wider question: how does Moat actually compare to
the real competitors in its category, and what would make it more powerful. Research only — no
code changes here, matching how `simplicity-and-completeness-review.md` worked last time (findings
first, an explicit "solve these" ask decides what gets built).

**Sources**: live web search against current official docs/changelogs/knowledge-bases for each
competitor (August 2026), cross-checked against this session's own reading of Moat's full
`CHANGELOG.md`, `README.md`, `src/types.ts`, `rules/dnr/manifest.json`, and every prior
`docs/research/*.md` doc. Confidence is marked per claim where it matters (verified live vs.
general knowledge).

## 1. Feature-by-feature comparison

| | Moat | uBlock Origin | AdGuard (extension) | Brave Shields | Ghostery | Privacy Badger | DuckDuckGo Privacy Essentials |
|---|---|---|---|---|---|---|---|
| Network blocking | DNR static rules (~274k, 18 AdGuard lists) | Full MV2 power on Firefox only; Chrome gets "Lite" (DNR, reduced) | Fully MV3-native, precompiled DNR + "Quick Fixes" dynamic-rule channel | Browser-engine level (not an extension) — EasyList/EasyPrivacy/uBO lists + own lists | TrackerDB (proprietary database) + crowdsourced discovery | No filter lists — learns trackers behaviorally from cross-site cookie/beacon/storage use | Tracker Radar dataset + Smarter Encryption (HTTPS upgrade list) |
| Cosmetic filtering | Domain-bucketed `<style>` injection, element picker (hide/hide-once/gray-out) | Full procedural filters (`:has()`, `:xpath()`) on Firefox; reduced on Chrome Lite | Full (unaffected by MV3 — runs via content scripts, not DNR) | Present, weaker than uBO per 2026 reviews (YouTube/Reddit still show some ads even in Aggressive mode) | Present, "visual clutter" removal | **None — not an ad blocker by EFF's own framing** | Minimal (cookie banners only, no general element hiding) |
| Anti-fingerprinting | Real API-level noise: canvas/audio/WebGL + navigator bucketing, deterministic per install (opt-in) | **None — explicitly declined scope** per uBO's own wiki | Script/domain-blocking only, no true API-level spoofing despite "Tracking Protection" branding | Per-session randomization across canvas/WebGL/audio/screen/GPU-driver strings; discontinued a separate "Strict" mode in 2025 after <0.5% adoption and high breakage | Not a focus; no deep spoofing | N/A (not its model) | Not a focus |
| Consent-banner handling | Consent-O-Matic interpreter, auto-reject, opt-in | Requires manually subscribing to third-party annoyance lists | Built-in "Cookie Notices" filter (hides/blocks the banner, not necessarily auto-reject-and-decline) | Present via filter lists | "Never-Consent" — built-in auto-reject | None | Built-in auto-handling |
| Transparency/attribution UX | "By company" collapsed list (Ghostery TrackerDB), no drilldown yet | Raw request-level Logger (Firefox only; power-user tool, not consumer-friendly) | Filtering log, but MV3 degrades it to "assumed" matches in the packaged build | Icon + block count + two named risk tiers, no per-tracker detail | **Full Tracker Panel: every tracker + operating company, per page** | Three-state slider per domain (allow/cookie-block/full-block) | Letter grade (A–F) + "enhanced from X to Y" |
| Portability/sync | Export/import (JSON) + opt-in `storage.sync`, off by default | Piggybacks on browser account sync only, same-browser only | JSON export/import + "Share Settings" link/QR, cross-browser | N/A (browser setting, not portable) | N/A | N/A | N/A |
| Extras beyond blocking | **Leaked-password check (HIBP k-anonymity)**, CNAME uncloaking (Firefox), GPC header | None (deliberately narrow scope) | Annoyances suite (social widgets, mobile banners), ecosystem cross-sell (DNS/VPN apps) | Phishing/malware warnings, HTTPS upgrade | None beyond Never-Consent | GPC/DNT signal sending | Email Protection (tracker-stripping alias), GPC, Smarter Encryption, paid Privacy Pro (VPN + data-broker removal + identity restoration, US-only) |
| Onboarding philosophy | No nag screens, no onboarding tabs, one-time popup card | Minimal/utilitarian, no forced tutorial | No hard paywall day-to-day; soft ecosystem cross-promotion | Zero-config, on by default | Tracker Panel is the "report" | New-install popup is empty until it learns — documented UX complaint | Grade badge is the most legible non-technical pattern found |
| Monetization | Free, no premium tier, no telemetry | Free, no donations accepted for the project itself, refuses Acceptable-Ads-style deals | Free extension; premium tier gates the *separate* desktop/mobile/DNS/VPN apps | Free (built into Brave); separate paid Brave VPN product | Free, no subscription for core features | Free (nonprofit/EFF) | Free extension; paid Privacy Pro bundle layered on top |

## 2. Where Moat already leads or is differentiated

- **Real API-level fingerprint noising.** uBlock Origin explicitly declines this scope entirely
  (its own wiki states spoofing "should be handled by separate dedicated tools"). AdGuard's
  "Tracking Protection" branding sounds comparable but is script/domain-blocking under the hood,
  not true canvas/WebGL/audio API-level spoofing. Moat's `fingerprintGuard.ts` does the real thing
  — deterministic per-install noise on `toDataURL`/`toBlob`/`getImageData`/`AudioBuffer`, generic
  WebGL vendor/renderer strings, bucketed `hardwareConcurrency`/`deviceMemory`. Of the six
  competitors researched, only Brave Shields does something comparably deep (see §3g for the one
  real difference worth a closer look).
- **A free, built-in leaked-password checker.** None of the six researched competitors ship
  anything like this in their free tier. DuckDuckGo's closest analog (data-broker removal +
  identity-theft restoration) sits behind its $9.99/mo Privacy Pro bundle, US-only. Moat's HIBP
  k-anonymity check (0.11.11) is free, off-by-default, and entirely local except the unavoidable
  5-character hash-prefix query.
- **Popup/redirect-tab closing as a named, first-class capability.** Across all six competitors'
  own marketing and documentation, this specific behavior — silently closing a hijacked new tab
  that already opened — doesn't appear as a distinctly named feature anywhere. It's implicitly
  covered piecemeal (AdGuard's "Popups" annoyance filter, Brave's ad-blocking catching some
  popunder scripts before they fire), but none of them frame "we watch for and close rogue tabs"
  as Moat does with `mainWorldGuard.ts` + the background tab safety net. This looks like a genuine,
  unclaimed positioning wedge — a messaging opportunity more than an engineering one.
- **No monetization, no Acceptable-Ads-style paid allowlisting.** Same trust position as uBlock
  Origin (which refuses donations for itself and has never done paid-allowlist deals, unlike
  AdBlock Plus/Eyeo's "Acceptable Ads" — a 2026 NYU study found ABP's Acceptable Ads users actually
  saw *more* problematic ads than users running no blocker at all in some conditions). README
  currently doesn't state this outright as a standing commitment — worth adding explicitly (folded
  into opportunity 3a below).
- **Consent-O-Matic-based auto-reject** is functionally on par with Ghostery's "Never-Consent" —
  both auto-decline consent banners on the user's behalf, off/on-by-default choices aside.

## 3. Real, concrete opportunities (ranked, not yet built)

### (a) Update README.md for 0.11.2–0.11.11
README's Features list and "How it works" section were verified this session to predate the
entire previous plan's shipped work. Missing from README today despite being live in
`CHANGELOG.md`: the keyboard shortcut, the "Report a problem" button, settings export/import,
opt-in `storage.sync`, the first-run/update-notice popup cards, the full i18n infrastructure
migration, and the leaked-password checker. Pure documentation catch-up — zero engineering risk,
should happen regardless of what else from this list gets picked up. Also a natural place to add
the explicit "no paid allowlisting, ever" statement from §2.

**Status: done** (`bc23f67`, docs-only, no version bump).

### (b) ClearURLs gap-audit follow-through
`clearurls-gap-audit.md` already identified concrete, currently-missing tracking params for
google/facebook/amazon/bing/twitter/reddit/twitch/youtube — Moat's highest-traffic first-party
surfaces. Bounded, low-risk (new domain-scoped `removeParams` DNR rules, the exact shape already
used for 848 existing groups), not yet turned into rules.

**Status: done (v0.11.12).** `ie`/`dpr` (Google) deliberately excluded from what shipped — not
obviously tracking-only by name alone, per the caveat above.

### (c) Tracker-by-company drilldown
Moat's popup already attributes matched rules to companies via Ghostery's own TrackerDB
(`matchStats.ts`, `scripts/lib/ruleCompany.mjs`) but stops at a flat collapsed list. Ghostery's own
Tracker Panel goes one step further: click a company for a short description. Since Moat already
has the attribution data and is drawing from the *same* TrackerDB Ghostery itself uses, this is a
small, bounded UI addition, not new data-collection work.

**Status: done (v0.11.13).**

### (d) "Report card"-style popup summary
DuckDuckGo's letter-grade + "enhanced from X to Y" framing was the single most legible
non-technical UX pattern surfaced across all six competitors — more approachable than Privacy
Badger's slider (documented as confusing new users) or a raw request logger. Moat's popup already
computes real, accurate per-page Ads/Trackers/Popups counts (`getMatchedRules`); this would be a
presentation layer over existing data, not new detection logic — directly serves the "simplicity
for everyone" goal from the original completeness review.

**Status: done (v0.11.13).** Implemented as a bucketed plain-language line, not a letter grade —
Moat has no independent data on the site itself to grade the way DuckDuckGo's feature implies.

### (e) Emergency "quick-fix" filter channel
AdGuard's "Quick Fixes filter" pushes near-real-time anti-adblock-circumvention/breakage fixes
through DNR's dynamic-rule quota, sidestepping the full extension-store review cycle MV3 otherwise
requires for any static-ruleset change. Moat's `liveUpdates.ts`/`liveRedirectRules.ts` already do
exactly this mechanically — daily fetch + dynamic-rule application — just scoped today to the
redirect-domain list alone. Extending that existing pipeline to also carry emergency filter patches
is reuse of a proven mechanism, not new architecture. Directly relevant since Moat's own research
(`ad-blocker-architecture-and-roadmap.md`) previously flagged anti-adblock-circumvention as an
"evidence-limited" open question with no concrete mechanism identified — this is that mechanism.

**Status: done (v0.11.14).** `live/quick-fixes.json` ships empty — this is the channel, not an
active patch. Deliberately narrower than a fully general remote-rule channel: an entry can only
block, allow, or strip query params, never redirect to an arbitrary URL, so a compromised feed
can't be used to hijack traffic.

### (f) Objective coverage benchmark
Reviewers scored AdGuard's MV3 extension against uBlock Origin Lite on public test suites (one
cited result: 6/14 vs. 14/14 blocked-test-case score on a 2026 comparison). Running Moat through
the same public ad-blocker-testing sites (adblock-tester.com, d3ward's test) would give a concrete,
externally-comparable number instead of relying on raw bundled-rule counts, which say nothing
about real-world hit rate.

**Status: pending.** Needs a real browser with Moat loaded unpacked; the coding-agent's browser
automation in this environment can't reach `chrome://extensions` or drive the native "Load
unpacked" file picker. User elected to load the dev build themselves and have the agent drive the
benchmark sites once it's loaded, rather than skip this item or run it fully manually.

### (g) Fingerprint-rotation finding — flag, not fix
Moat's fingerprint noise is deterministic *per install, forever* (`fingerprintSeed`, generated once
and reused). Brave deliberately rotates its noise *per session* — confirmed reasoning: a fake
fingerprint that never changes can itself become a stable, trackable identifier across sites and
over time, which defeats the point. This is worth a dedicated look in a future pass (the tradeoffs
— session-rotation breaks the "same page read twice gets the same noise" invariant some anti-bot
systems might flag as itself suspicious — need real thought, not a decision made inside this
audit).

**Status: done (v0.11.14) — added as opt-in, not changed as default.** User's call: a new,
separately-toggleable "rotate noise every browser session" option, off by default and nested under
the existing fingerprint-resistance toggle, using `browser.storage.session` for the rotating seed.
The deterministic per-install default is unchanged for every existing user; only someone who
explicitly opts in gets Brave's model.

### (h) i18n: ship real translations
Infrastructure is complete (`default_locale`, `_locales/en/messages.json`,
`applyStaticI18n`/`getMessageOrFallback`, 0.11.8–10) but zero non-English languages exist yet.
Every competitor researched here ships localized UI. This is now a content-only lift, not an
architecture change — but needs an explicit scope/quality decision (machine-translated draft vs.
verified per-language) before starting, since a wrong or awkward translation is arguably worse than
staying English-only.

**Status: declined for now, by user decision.** Staying English-only — translations need ongoing
maintenance as strings change, and starting without a plan to keep them current isn't worth it.
Infrastructure stays in place for whenever that changes.

## 4. Confirmed correctly out of scope

Consolidating what's already been deliberately declined, so it isn't re-litigated by a future pass
rediscovering the same reasoning from scratch:

- **uBlock Origin's dynamic-filtering "firewall matrix"** — declined on philosophy grounds (Moat's
  "decide nothing for the user by default" stance), not technical infeasibility. uBO itself gates
  it behind an "I am an advanced user" opt-in for the same underlying reason.
- **Ghostery's `fetch`-monkeypatching for dynamic request rewriting** — declined; by Ghostery's own
  admission this "introduces site-breakage risks and latency," a bigger trust/breakage step than
  anything Moat's popup firewall does (which only wraps one narrow API, `window.open`).
- **HTTPS/TLS interception** (AdGuard's desktop-app-only capability, requires a local root
  certificate) — out of scope for a browser extension by construction; not something any of the
  six competitors' *extensions* do either, only their standalone apps.
- **VPN, network-wide DNS blocking, email tracker protection** (DDG's Privacy Pro, NextDNS/Control
  D) — all require server-side infrastructure Moat's zero-server, zero-telemetry model explicitly
  avoids (`PRIVACY.md`'s entire premise is no data collection, no accounts, nothing to run a
  backend for).
- **Multi-account containers** — Chrome has no equivalent extension API at all (confirmed
  directly); Firefox already ships this natively via Mozilla's own first-party extension.
- **Paid/premium tier, Acceptable-Ads-style allowlisting** — directly contradicts the trust
  position established in §2; see 3a for making that commitment explicit in README rather than
  just implicit.
- **Font-enumeration fingerprinting resistance** — real architectural gap, not an oversight: no
  interceptable JS API exists the way canvas/audio reads do; noising generic layout-measurement
  APIs broadly risks real site breakage. Brave's fix requires patching the browser engine itself,
  not something an extension can replicate.
- **Instagram Stories ads** — investigated live; the ad slide shares the same full-screen viewer
  component as real stories, so the feed scanner's hide-the-container technique would blank
  everything. The real fix (auto-advance past the ad slide) is "act on the page," a bigger trust
  step than anything the scanner does today. Declined for now, not overlooked.
- **Decentraleyes-style local CDN mirroring** — researched, deemed buildable, deliberately deferred
  per the previous plan; ongoing catalog/version-staleness maintenance was the stated concern, not
  architecture. Notably, none of the six competitors researched here do this either — so it's not
  actually a competitive-parity gap, just a possible differentiator nobody's claimed. Leave
  deferred unless explicitly revisited.

# AI capabilities, lightweight/streamlining follow-up, and a launch-readiness re-audit

Four asks in one pass: (1) a fresh software/extension audit, (2) how to make it lighter, (3) how
to streamline the whole process, (4) where on-device AI could genuinely help. Written right after
making the repo public to unblock live updates (see CHANGELOG-adjacent context: both
`live/redirect-domains.json` and `live/quick-fixes.json` now resolve `200`, verified live).

**On (1)-(3): most of this ground is already covered.** [`systems-health-audit.md`](systems-health-audit.md)
(algorithmic complexity, storage patterns, caching, memory, dependency weight — 3/3 findings fixed
in v0.11.30) and [`lightweight-architecture-roadmap.md`](lightweight-architecture-roadmap.md)
(rule-budget mechanics, redundant-rule pruning, fingerprint-cached reapply, security pass — 4/4
follow-ups shipped v0.11.24–26) already did the deep passes. Re-running either from scratch would
mostly reproduce what's already there. What follows instead is: a short list of things verified or
found *fresh* in this pass, then the genuinely new material — AI capabilities, and release-process
streamlining specifically (narrower than "runtime architecture," which the roadmap doc already
owns).

## 1. Fresh findings from this pass

- **Regex-rule cap (flagged as unverified in `lightweight-architecture-roadmap.md` §2.4, now
  checked): 6 regex rules total, combined across every static ruleset**, against Chrome's
  documented 1,000-rule combined cap. Not a risk. Closes that doc's one open item.
- **Secret scan across full git history, run right before flipping the repo public: nothing
  found** (checked for API keys, tokens, private-key headers, password-shaped assignments across
  every commit, not just HEAD). The repo was safe to make public as-is.
- **Current build weight, measured fresh:** `dist/chrome` is 61MB unpacked, of which **49MB is
  `rules/dnr/`** — the bundled filter data is the overwhelming majority of the extension's size by
  construction (a real ad/tracker/phishing blocker with ~271k rules), not incidental bloat. The
  next-largest thing is JS/HTML/locale files at under 200KB combined. There isn't a "make the code
  lighter" opportunity left worth chasing — the weight is the filter data, and that's already been
  through two rounds of pruning (`pruneRedundantRules.mjs`, the reviewed-consolidation pass). The
  remaining `dist/chrome/_metadata` (12MB, Chrome's own artifact from loading unpacked locally)
  confirmed **excluded from the actual zip** — `chrome.zip`'s `_metadata` grep returned nothing,
  matching the exclusion fix from `systems-health-audit.md`.
- **Repo went public — one follow-up this creates, already handled:** the README's licensing note
  already says "if you publish this extension, keep the attribution... and check current license
  terms" — that was written for the *extension listing*, and reads the same now that the source
  itself is also public. Nothing to change there. Worth a human glance at whether you want the repo
  description/topics filled in on GitHub now that it's discoverable, but that's a GitHub-settings
  preference, not a code or docs task.

## 2. Streamlining the release process specifically

`docs/RELEASING.md` is a manual checklist, and every step on it is now satisfiable — but two of
its seven steps (unpacked-package testing in real browsers, checksums) still happen by hand each
time, and nothing enforces the checklist was actually followed before a tag goes out. Concretely:

- **No release automation exists yet** — `.github/workflows/ci.yml` runs typecheck/test/build/lint
  on every push, but there's no workflow that triggers on a version tag, rebuilds clean, runs
  `npm run zip`, computes checksums, and attaches both zips to a GitHub Release. Every one of those
  steps is already scripted (`npm run build`, `npm run zip`) — this would be wiring, not new logic.
  **Concrete shape:** a `release.yml` triggered on `v*` tags, doing `npm ci` → the existing
  typecheck/test/build/lint sequence → `npm run zip` → `sha256sum *.zip` → upload both as release
  assets. Turns RELEASING.md steps 2, 3 (partially — permission/provenance review still wants a
  human), 6 into one automatic, reproducible step, and gives you a durable checksum record for
  free (step 6 currently has nowhere to *record* the checksum it asks for).
- **Version-tag discipline isn't enforced.** `scripts/manifest.ts` already treats `package.json`
  as the one source of truth for `version` (with a comment recording the exact drift bug that
  happened before this existed) — but nothing checks that a pushed git tag matches
  `package.json`'s version, so the "a Git tag should identify exactly the source used" line in
  RELEASING.md is a convention, not something CI verifies. A one-line check in the same release
  workflow (`test "v$(node -p "require('./package.json').version")" = "$GITHUB_REF_NAME"`) closes
  that gap cheaply once the workflow above exists anyway.
- **The two manual-only items from the earlier conversation this pass continues from** — loading
  `dist/chrome` unpacked for a real click-through, and capturing Chrome Web Store screenshots —
  are still blocked on the same thing: browser automation can't drive `chrome://extensions` or a
  native file picker. That's a hard boundary, not a streamlining opportunity; it stays a manual
  step every release.

## 3. AI capabilities — what's real right now, and where it does/doesn't fit Moat

Researched fresh (not from training-data memory): Chrome ships six on-device "built-in AI" APIs as
of 2026 — Prompt, Summarizer, Writer, Rewriter, Translator, Language Detector — all running Gemini
Nano locally, no API key, no network call, no data leaving the device.
([developer.chrome.com/docs/extensions/ai](https://developer.chrome.com/docs/extensions/ai),
[developer.chrome.com/docs/ai/prompt-api](https://developer.chrome.com/docs/ai/prompt-api))
The Prompt API is stable for extensions specifically as of Chrome 138 — the origin-trial permission
extensions needed earlier has since expired/been removed, so no manifest permission is required
today. **The catch that matters most for a decision here: hardware gating.** Per Chrome's own
requirements, the model needs **22GB+ free disk space, a GPU with >4GB VRAM (or 16GB+ RAM with 4+
cores as a fallback), and an unmetered connection for the one-time download.** That's a real chunk
of Moat's actual install base that will never have this available, no matter how the feature is
built — anything using it must be a pure enhancement with the exact same silent-fallback posture
Moat already uses for `getMatchedRules`/CNAME-resolution/etc., never a dependency.

**A second, harder constraint specific to Moat's core function:** `declarativeNetRequest` decides
whether to block a request synchronously, inside the browser engine, before any extension JS runs
— that's the entire reason MV3 requires DNR instead of a blocking `webRequest` handler in the first
place (see README's "Popular/redirect firewall" and CNAME sections for the same boundary discussed
elsewhere). An async on-device model call cannot sit in that path at all. So "use AI to make better
blocking decisions" isn't a build choice Moat is behind on — it's architecturally excluded from the
one thing DNR does, the same category of constraint as "can't do Ghostery's `fetch`-monkeypatching
on Chrome" already recorded in the README. Worth stating plainly so it isn't rediscovered later.

Where that leaves real opportunities, ranked by fit:

- **(a) Build-time translation drafts, not a runtime dependency — the strongest fit.**
  [`competitive-gap-audit.md`](competitive-gap-audit.md) §3h already flagged "i18n infrastructure
  is complete, zero non-English locales exist" as an open item needing a scope decision. The
  Translator API (or, just as well, an LLM coding session like this one) run *once, at
  content-authoring time*, over `_locales/en/messages.json` to produce first-draft
  `_locales/<lang>/messages.json` files is zero runtime risk, zero hardware gating, and zero new
  code shipped to users — it's a documentation-adjacent task, not a feature. Needs a human
  spot-check pass before shipping (machine translation of UI strings with placeholders like
  `$COUNT$` needs verification the placeholder syntax survived), but that's a review cost, not a
  build cost.
- **(b) Consent-banner classification for platforms with no rule yet — real, but crosses a trust
  boundary Moat has explicitly drawn.** The auto-reject consent interpreter (`src/content/consent/`)
  only ever executes a declarative rule format — "inert JSON describing which selector to click,
  never code to run" is the README's own framing, chosen specifically to keep the same trust
  boundary as cosmetic selectors. Using a model to infer "this button probably means reject" on an
  unrecognized banner is a materially different kind of decision — inferred intent acted on
  automatically, not a matched rule — closer in kind to the aggressive feed scanner (already
  opt-in, off by default, and explicitly named as carrying more false-positive risk than a fixed
  selector) than to plain rule-following. If this gets built, it should be opt-in, and probably
  should *suggest* a new Consent-O-Matic-format rule for the existing interpreter to run
  deterministically next time, rather than have the model click things directly on every visit.
  Flagging as a real idea worth an explicit decision, not something to build unilaterally — same
  posture the firewall-matrix and fetch-monkeypatching declines already use in the README.
- **(c) Dev-time maintenance triage — the option that's actually the best return for the effort,
  and doesn't touch the shipped extension at all.** `consolidation-candidates-reviewed.md` already
  found 35 of ~727 rule-consolidation candidates confirmed to a single company via TrackerDB
  cross-reference, leaving ~692 unreviewed by design (the doc calls this "nothing more than a list
  for a human to review one domain at a time"). That review is exactly the kind of bounded,
  source-grounded classification task an LLM pass is good at — run as a one-off `scripts/analysis/`
  tool (same pattern as the existing reviewed-consolidation script), output reviewed by a human
  before anything merges, same as now. Not shipped in the extension; a maintainer-side research
  accelerant only.
- **(d) Declined outright: AI-generated selectors for the element picker.**
  `generateSelector.ts`'s deterministic heuristic (stable id → stable class → structural path,
  rejecting generated-looking identifiers) already produces good selectors instantly, with no
  hardware gating and no non-determinism. An AI call here would add latency and inconsistency for
  a problem that's already solved well. Not worth building.
- **(e) Declined outright: AI-assisted "Report a problem" drafting.** The button already sends the
  minimum useful payload (hostname + enabled filter groups) specifically to avoid leaking tracking
  params in a public issue. Having a model expand that into prose adds a moving part and a
  hardware-gated failure mode for a form GitHub already renders fine as-is.

## 4. Anything else outstanding

Everything else raised earlier in this conversation stands as it was — this pass didn't change any
of it: the manual unpacked-build smoke test and Chrome Web Store screenshots are still blocked on
you loading `dist/chrome` yourself (browser automation can't reach `chrome://extensions` or a
native file picker); `docs/research/vpn-and-secure-connection-feasibility.md` is still untracked
and unaddressed; the Chrome Web Store listing fields (short description, category, the Privacy
Practices tab's per-permission justifications, promo tile) still live only in the Developer
Dashboard.

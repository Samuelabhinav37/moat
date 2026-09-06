# Data Usage, Optimization, UI, and User-Demand Research (2026-09-05)

This doc covers five things the existing research corpus does not: (1) Moat's actual measured
resource footprint plus how competitors report their own, (2) a source-checked reconciliation of
`ad-blocker-architecture-and-roadmap.md`'s 9 "Candidates for Moat" against current code, (3) a
fresh pass on optimization techniques not already covered by that doc's §1/§5, (4) a real
side-by-side of Moat's actual UI against six competitors' actual UI, and (5) checkable user
pain-point research with philosophy-fit ratings. It does not re-litigate
`competitive-gap-audit.md`, `competitive-gap-audit-2026-09.md`, or `feature-expansion-survey.md`,
all of which remain fully resolved as of their own last passes.

---

## 1. Moat's measured resource footprint, and how the six competitors report their own

**Moat's one real data point.** Live-measured on real instagram.com with Moat active in a real
Chrome session: 92 network resources, ~1.99MB total transfer, page-load event at ~1.95s, JS heap
~55MB (page-level, not extension-isolated). This is a **single-condition measurement, not a
verified delta** — there is no no-extension baseline (would require Incognito, not drivable via
this session's browser automation) and no per-extension CPU/memory reading (would require Chrome's
own Task Manager, a `chrome://` UI not drivable either). Treat it as "here's what a real page looks
like with Moat on," not "Moat costs X."

**What the other five (six, counting uBOL as a distinct product) actually publish about their own
footprint** — the honest finding here is that most of them publish nothing:

| Tool | Self-reported data | Verdict |
|---|---|---|
| **AdGuard** | None found. [AdguardTeam/AdguardBrowserExtension#244](https://github.com/AdguardTeam/AdguardBrowserExtension/issues/244) shows AdGuard has never posted benchmark numbers even when a user directly asked — the issue only cites a third-party raymond.cc benchmark. | No public self-reported footprint data. |
| **uBlock Origin (classic)** | gorhill maintains long-running comparative wiki pages — [Own memory usage: benchmarks over time](https://github.com/gorhill/uBlock/wiki/Own-memory-usage:-benchmarks-over-time), [uBlock vs. ABP: efficiency compared](https://github.com/gorhill/uBlock/wiki/uBlock-vs.-ABP:-efficiency-compared) — real numbers, but embedded in screenshots, not page text. | Longest-running self-benchmarking practice of the six, format aside. |
| **uBlock Origin Lite (uBOL)** | No numeric claim. Its own FAQ makes an architectural (not measured) claim instead: because it's "entirely declarative" via `declarativeNetRequest`, "uBOL itself does not consume CPU/memory resources while content blocking is ongoing" — contrasted against extensions with a persistently-active service worker. The same FAQ is candid that it won't quantify further: "only benchmarks with proper methodology can really answer that question, otherwise it's all speculations." ([uBOL-home wiki FAQ](https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ))) | Deliberately declines to publish a number — more honest than most, still not comparable to Moat's disclosure. |
| **Ghostery** | Beyond the sub-millisecond claim already cited in the architecture doc, a fuller 2019 study exists: [ghostery.com/blog/adblockers-performance-study](https://www.ghostery.com/blog/adblockers-performance-study) — engine startup memory "1.8 MB," median request-processing "0.007 ms," engine-load-from-cache "0.03 ms," vs. uBO/ABP/DDG. A second post, [ghostery.com/blog/browse-faster-with-ghostery](https://www.ghostery.com/blog/browse-faster-with-ghostery), claims page loads "~2x faster" and "25% less energy" (physical AC-current-sensor methodology, 2018 laptop, Firefox 112, Ubuntu 22.04). Both vendor-authored, neither newer than ~2019-2020 in substance. | Richest published methodology of the six, but stale (pre-2020 data). |
| **Privacy Badger (EFF)** | None found, 2018-2025. EFF's own [2020 "Privacy Badger Is Changing to Protect You Better"](https://www.eff.org/deeplinks/2020/10/privacy-badger-changing-protect-you-better) post was fetched directly and contains no memory/CPU discussion at all — only a fingerprinting-attack-complexity aside noting learning is "more resource-intensive." GitHub issues (`EFForg/privacybadger` #1707, #2954) document user-*reported* high-CPU bugs, not vendor figures. | No public self-reported footprint data — notable since it's the one heuristic-learning engine of the six, the architecture where footprint claims would matter most. |
| **Brave Shields (adblock-rust)** | Already-cited 75%/~45MB FlatBuffers reduction ([brave.com/privacy-updates/36-adblock-memory-reduction](https://brave.com/privacy-updates/36-adblock-memory-reduction/)) plus, newly surfaced here, the original 2019 Rust-rewrite post's separate CPU/latency numbers: "69x faster on average," "5.7μs avg/request" (EasyList+EasyPrivacy combined), "4.6μs" with browser-integrated info — explicitly no memory figures in that earlier post. ([brave.com/blog/improved-ad-blocker-performance](https://brave.com/blog/improved-ad-blocker-performance/)) | Most complete, most recent, most quantified public performance story of the six — and the only one not extension-shaped (compiled into the browser). |
| **DuckDuckGo Privacy Essentials** | None found. A site called factually.co surfaced specific-sounding numbers ("≤24KB standby," "142KB bundle," "CPU 31s→1.6s") that read as AI-generated content-mill material, not primary or credible — explicitly **not** reported as fact here. | No public self-reported footprint data. |

**Independent, non-vendor sources worth citing directly:** Pearce (Michigan Tech), "Energy
Conservation with Open Source Ad Blockers," *Technologies* 8(2):18, 2020, peer-reviewed
([mdpi.com/2227-7080/8/2/18](https://www.mdpi.com/2227-7080/8/2/18)) — measured page-load-time
reduction of 11% (AdBlock+), 22.2% (Privacy Badger), 28.5% (uBlock Origin) with energy/cost
extrapolations; and Papadopoulos & Lukic (Goethe University Frankfurt), "Privacy vs. Profit: MV3's
Impact on Ad Blocker Effectiveness," PoPETs 2026(1)
([petsymposium.org/popets/2026](https://petsymposium.org/popets/2026/popets-2026-0027.php),
arXiv:2503.01000) — 4 blockers × MV2/MV3 × 924 sites, N=7,392, though effectiveness-focused rather
than memory/CPU.

**Reading across this table**: four of six competitors (AdGuard, Privacy Badger, DDG, and
uBOL by explicit choice) publish **zero** self-reported resource numbers. Only Ghostery and Brave
have anything approaching a methodology write-up, and Ghostery's is six years stale. Against that
bar, Moat volunteering one honestly-caveated real measurement — while being unable to produce a
clean baseline delta and saying so — is already more transparent than most of the field, not less.
No vendor documents referencing Chrome's own newer per-extension memory/CPU indicator in
`chrome://extensions` either; that surface appears to exist but isn't part of anyone's public
messaging yet, Moat included.

---

## 2. "Candidates for Moat" reconciliation (all 9 checked against current code)

`ad-blocker-architecture-and-roadmap.md` is dated 2026-08-24 and closes with 9 unmarked candidate
items. Checked directly against `src/`, `scripts/`, `CHANGELOG.md`, `README.md`, and
`docs/design-notes.md` rather than trusted from the doc's own framing:

| # | Candidate | Verdict | Evidence |
|---|---|---|---|
| 1 | Ship AdGuard's bundled `$redirect` resource files | **Shipped — v0.7.5**, well before the doc was written | `scripts/lib/redirectResources.mjs`'s `resolveRedirectResource`; CHANGELOG v0.7.5: "Stopped dropping ~990 `$redirect` filter rules," resources vendored into `rules/redirect-resources/`, wired into `web_accessible_resources`. |
| 2 | Adopt NextDNS's CNAME-cloak-destination list | **Shipped — v0.9.0** | README licensing section cites `nextdns/cname-cloaking-blocklist` (MIT); CHANGELOG v0.9.0 confirms adoption "as lower-risk" after checking NextDNS's own README. |
| 3 | Background-worker DoH lookup for CNAME uncloaking (exploratory) | **Genuinely still open**, correctly left undecided | No DoH/`fetch`-based resolution found anywhere in `src/`; `cnameUncloak.ts` still only covers Firefox's native `dns.resolve()` path. This is the one item where "still open" is the accurate, intended state — it was flagged as a design decision, not a default-yes, and no decision has been made either way. |
| 4 | Adopt Consent-O-Matic's declarative action model | **Shipped — v0.8.0** | `src/content/consent/`, README: "Cookie-banner rules are vendored from Consent-O-Matic... Moat's interpreter is written from scratch against their schema." CHANGELOG v0.8.0: "interpreter for Consent-O-Matic's declarative rules." |
| 5 | Font-fingerprinting: Brave's hybrid randomized-subset model | **Explicitly declined, not merely unbuilt** — and declined for a stronger reason than the roadmap doc assumed | `docs/design-notes.md` "Researched but not built yet" section: Brave's approach works because Brave patches font enumeration in the browser engine's own C++ layer; the actual detection vector (invisible-text width comparison via `offsetWidth`/`getBoundingClientRect`) has no dedicated, interceptable JS API the way canvas/audio do, so noising it broadly risks real site breakage nothing else in the fingerprint guard risks. This is a real architectural dead-end for *any* extension, not a cost/priority call — the roadmap doc's "cost: medium to large" framing undersells that this was already researched and closed. |
| 6 | Shard/gate generic cosmetic filters by observed DOM content, not domain hash | **Genuinely still open** | `scripts/update-cosmetics.mjs` still writes one flat `generic` selector array shipped to every page, separate from the 64 domain-hash buckets — exactly the "ship all generics to every page" pattern the architecture doc guessed at. No DOM-surveyor or class/id-hash-map gating exists. |
| 7 | Add a lightweight per-tab request/rule inspector ("logger") | **Shipped — v0.7.7**, also well before the doc | `src/logger/logger.html`, `src/background/ruleLogger.ts` (ring-buffer-backed, per-tab, gated to `onRuleMatchedDebug`/unpacked-only exactly as the candidate described), linked from Settings → About → Debugging. |
| 8 | Ghostery TrackerDB company attribution | **Shipped — v0.7.6** (base attribution) **, expanded v0.11.13 and v0.11.40** | CHANGELOG v0.7.6: "By company" breakdown sourced from `@ghostery/trackerdb`; v0.11.13 added click-through per-company description/category/link (briefly inside the popup, reverted); v0.11.40 moved that drill-down into a dedicated Settings → Trackers tab instead. README's licensing section confirms CC-BY-NC-SA-4.0 compatibility was checked. |
| 9 | Explicitly decline uBO's firewall matrix and Ghostery's `fetch`-monkeypatching | **Shipped as a decision**, documented twice | `docs/design-notes.md` "Researched but not built yet" carries both with full reasoning; `competitive-gap-audit-2026-09.md` §4 independently re-confirmed both verdicts unchanged as of 2026-09-05. |

**The real finding here isn't any single row — it's the pattern.** Five of nine candidates (1, 2,
4, 7, 8) were already shipped, several of them (1, 7, 8's base form) *years* of version numbers
before the architecture doc that "candidated" them was even written (v0.7.5-v0.7.7 vs. a doc
written against what was already a v0.11.x codebase). That means the architecture doc's closing
list was assembled from external research without cross-checking the repository's own history —
worth noting for future passes of that doc, and worth updating it with status markers now that
this reconciliation exists. Only two items (3, 6) are genuinely open engineering work; one (5) was
mis-costed as buildable when Moat's own prior research had already closed it as architecturally
impossible for an extension.

---

## 3. Fresh optimization-technique research (new ground only)

Explicitly not re-covering rarest-token bucketing, the hostname trie/WASM, DOM-surveyor gating,
class/id-hash cosmetic sharding, or uBOL's build-time minimization goal — all already covered in
`ad-blocker-architecture-and-roadmap.md` §1/§5.

- **MV3 static-rule-budget eviction: no vendor documents a ranked-drop algorithm.** This is a
  genuine industry-wide gap, not a missed citation. Firefox silently truncates a static ruleset
  past its 5,000-rule cap with no ranking ([MDN: declarativeNetRequest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest)).
  A tracked uBOL issue describes filter lists "turn[ing] themselves off after about ten minutes"
  once a limit is hit, with zero technical detail on selection order
  ([uBOL-home#317](https://github.com/uBlockOrigin/uBOL-home/issues/317)). AdGuard's public lobbying
  ([w3c/webextensions#318](https://github.com/w3c/webextensions/issues/318)) pushes to *raise* the
  ceiling (`MAX_NUMBER_OF_STATIC_RULESETS` 50→100) rather than propose smarter eviction; its actual
  production mitigation is orthogonal — a reserved "Quick Fixes" pool of *dynamic* rules for
  hot-patching outside the static budget entirely, sidestepping the eviction question rather than
  solving it ([adguard.com/en/blog/review-issues-in-chrome-web-store](https://adguard.com/en/blog/review-issues-in-chrome-web-store.html)).
  Moat's own README already documents `filterGroups.ts` dropping "the least-essential first" when
  budget is tight — on the evidence gathered here, that's already a more explicit, user-visible
  prioritization scheme (the Filter Lists tab shows which lists didn't enable) than any of the five
  competitors publish. Worth keeping, not worth treating as behind.
- **Worker-thread/`chrome.offscreen` offloading: nothing found, industry-wide.** `chrome.offscreen`
  exists precisely for DOM-dependent parsing a service worker can't do
  ([Chrome for Developers: offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)),
  but no ad blocker among the six documents using it, or a dedicated Web Worker, for off-main-thread
  filter-list compilation or matching. A real, unclaimed area — but also unclaimed by Moat, so this
  is a frontier note, not a comparison finding.
- **WASM beyond uBO's trie: two genuinely new data points.** AdGuard's `tsurlfilter` monorepo
  depends on `@adguard/re2-wasm` (RE2 compiled to WASM) for regex-rule *validation*, a distinct
  use-case from hostname-trie matching
  ([AdguardTeam/tsurlfilter](https://github.com/AdguardTeam/tsurlfilter)). Brave's `adblock-rust`
  ships an official WASM build for non-browser hosts, published as `adblock-rs` on npm
  ([npmjs.com/package/adblock-rs](https://www.npmjs.com/package/adblock-rs)) — but no performance
  numbers specific to that WASM build were found, only generic unrelated Rust/WASM claims. Neither
  is directly actionable for Moat today; both are noted for completeness.
- **No 2026-era production-profiling case study found anywhere** — searches surfaced only generic
  SEO "reduce Chrome RAM" listicles pointing at Chrome's Task Manager (Shift+Esc), not a vendor or
  DevTools-driven write-up, and no evidence of a newly shipped `chrome://extensions`
  performance/memory surface being referenced by any of the six vendors.
- **Rule-count reduction via regex/wildcard consolidation: nothing new** beyond Chrome's own
  documented `regexFilter`/`regexSubstitution` support and AdGuard's `dnr-converter` package's
  incremental wildcard-TLD handling — format support, not a novel merging algorithm.
- **Content-script injection timing as a deliberate perf choice: nothing vendor-specific.** Only
  generic Chrome/Edge guidance exists (Edge's own docs: `document_start`/`document_end` "take time
  the page wanted," only `document_idle` is scheduled around the page —
  [learn.microsoft.com: minimize page load time impact](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/minimize-page-load-time-impact)).
  None of the five competitors publish a rationale tying their own `run_at`/`matches` choices to
  performance.

---

## 4. UI/UX side-by-side

### Moat (read directly from source: `src/popup/popup.html`, `src/options/options.html`,
`src/ui/theme.css`, CHANGELOG v0.11.41/42)

**Popup** (260px wide, dark-only): brand row (logo + "Moat" + a "Settings" text link, no icon-only
gear); a single large stat-hero card — one big monospace number ("Blocked on this page"), a
"Light/Moderate/Heavy" read underneath; a 3-segment Ads/Trackers/Popups breakdown row; an optional,
collapsed-by-default `<details>` "By company" list (zero clicks to see the count, one click to see
company names); a site card with the hostname and a single on/off toggle ("protected"/paused, blue
dot indicator); and three stacked full-width action buttons (Reload page, Block an element…, Report
a problem…) rather than a button row. v0.11.41 explicitly reworked this to remove a brown-gradient
background, retone an "acid" green, and turn near-invisible link text into a real accent blue —
documented visual-clarity fixes, not a redesign of structure. **No settings/toggles live in the
popup at all** beyond the one pause switch — everything else is one click away in Settings.

**Settings** (max-width 560px, five tabs: Protection / Filter Lists / Custom Rules / Trackers /
About): card-based, each toggle row pairs a small line-icon, a title, and a one-sentence hint —
notably verbose compared to a bare label (e.g. fingerprint-resistance explicitly warns "Can
occasionally interfere with a CAPTCHA" right in the row, not buried in a tooltip). Filtering level
is five preset buttons (Off/Lite/Essential/Standard/Strict) with a budget-warning banner that
appears only when Chrome's shared static-rule ceiling has actually forced a list off. The Trackers
tab (added v0.11.40, after an earlier v0.11.13 attempt to put the same drill-down *inside* the
popup was reverted as "unwanted popup UI") lists company name, count, and a two-line-clamped
description per company — Ghostery-style attribution, kept out of the popup entirely. About bundles
version info, a link to the diagnostic-only rule-match logger, and export/import + sync — all
plain, no nag banners, no upsell.

**A structural note worth flagging on its own**: `src/ui/theme.css` declares
`color-scheme: light dark` but defines every custom-property color unconditionally (no
`@media (prefers-color-scheme: light)` block) — Settings and popup are **always dark**, regardless
of the user's system theme. This is the literal inverse of uBlock Origin's own long-standing user
complaint (below): uBO users have begged for dark mode for years; Moat ships dark-only by default
with no light-mode option at all. Neither is obviously more "wrong," but it's worth naming
precisely rather than assuming Moat is unaffected by that complaint category.

### The six competitors

- **uBlock Origin.** Popup's single biggest element is a large blue on/off power button; directly
  below it, a stats block (page count + running total + percentage) is visible with **zero
  clicks**. A "More" (▾) toggle exposes a per-domain three-column table one click deep. A 6-icon
  tool row (zapper, picker, report, logger, gear) opens the separate, dense, tabbed Dashboard
  (Settings/My filters/My rules/Trusted sites/Logger) built for power users — raw filter-syntax
  editors and a per-rule matrix live there. Tone: utilitarian, clinical, numbers-first, zero
  mascot. ([Quick guide: popup UI](https://github.com/gorhill/uBlock/wiki/Quick-guide:-popup-user-interface),
  [Dashboard](https://github.com/gorhill/uBlock/wiki/Dashboard))
- **AdGuard.** Official marketing pages are trust/review-badge-first ("20,647 'Excellent'
  reviews") rather than data-dense; confirmed facts are a main on/off toggle, a separate
  "Tracking protection" screen, and the on-page Assistant tool for element blocking. Exact popup
  pixel-layout isn't itemized in AdGuard's own pages — a real documentation gap, flagged rather
  than guessed at. ([adguard.com/en/adguard-browser-extension/overview](https://adguard.com/en/adguard-browser-extension/overview.html))
- **Brave Shields.** Address-bar lion icon opens a panel whose single biggest element is the
  domain name plus a total blocked-item count for that site — the count, not a toggle, is the
  visual anchor. A binary Shields up/down toggle sits at top; blocking-level (Standard/Aggressive)
  and cookie-control are one level down; clicking the blocked-scripts count drills two clicks deep
  into a full per-script list. Copy is casually playful ("creepy stuff that Brave blocked") but the
  panel itself is count-and-toggle minimal. ([Brave Help Center: using Shields](https://support.brave.app/hc/en-us/articles/360022806212-How-do-I-use-Shields-while-browsing))
- **Ghostery.** Own tagline: "Privacy you can see." Tracker Panel names which companies are
  tracking per page (per-tracker identification is the point, not a raw count) and a "Pause
  Ghostery" control (1hr/1day/always). Tone markets itself as "unobtrusive," "fire and forget" —
  accessible, non-technical branding rather than data-table density.
  ([ghostery.com](https://www.ghostery.com/), [changelog](https://www.ghostery.com/changelog))
- **Privacy Badger.** The three-state slider *is* the popup's entire content — one row per
  detected third-party domain, colored green (allowed) / yellow (cookie-blocked) / red (fully
  blocked), all visible with zero extra clicks; a "Disable for this site" control sits alongside.
  EFF's own copy leans playful/activist ("Privacy Badger springs into action"). ([Find out why
  Privacy Badger is blocking a domain](https://github.com/EFForg/privacybadger/wiki/Find-out-why-Privacy-Badger-is-blocking-a-domain))
- **DuckDuckGo Privacy Essentials.** Confirmed elements: a Privacy Grade (A-F) badge, a dashboard
  listing which companies were blocked, and a one-tap Fire Button. Brand tone: "Privacy,
  simplified" — positioned as the plain-spoken alternative to "Big Tech surveillance." Exact
  layout hierarchy wasn't confirmable from DuckDuckGo's own fetched pages in this pass — flagged
  as a gap rather than assumed. ([duckduckgo.com/extension-success](https://duckduckgo.com/extension-success))

**Reading across all seven (Moat included):** every one of the seven anchors its popup on exactly
one big visual element — uBO's power button, Brave's blocked-count, Ghostery's company names,
Privacy Badger's slider rows, DDG's letter grade, Moat's stat-hero number. Moat's choice (a calm
number in a card, not a button/badge/grade) sits closest to Brave's in spirit but without Brave's
playful copy, and closer to uBO's clinical numbers-first tone but with far less immediately visible
(uBO shows a full per-domain table with zero clicks; Moat shows three category chips and buries
company-level detail behind both a `<details>` toggle *and* a separate Settings tab). Moat is the
only one of the seven with literally nothing else live in the popup besides the one pause toggle —
every other tool surfaces at least one more control (a blocking-level selector, a slider bank, a
grade) without leaving the popup.

---

## 5. User pain points and feature requests, with philosophy-fit ratings

All items below trace to directly-read GitHub issues (title/body/reaction-count fetched via API,
not inferred from search snippets) unless marked otherwise; Chrome Web Store review text was not
reachable in this pass and is explicitly **not** claimed as a source.

- **uBlock Origin/uBOL**: stricter 1st-party tracker blocking wanted (204👍,
  [uBlock-issues#780](https://github.com/uBlockOrigin/uBlock-issues/issues/780)); long-standing
  dark-mode request for the dashboard (26👍, 72 comments,
  [uBlock-issues#401](https://github.com/uBlockOrigin/uBlock-issues/issues/401)); uBOL site
  breakage reports, e.g. google.com (12👍, 93 comments,
  [uBOL-home#476](https://github.com/uBlockOrigin/uBOL-home/issues/476)); standing request to
  view/edit custom filters from uBOL's dashboard (13👍,
  [uBOL-home#418](https://github.com/uBlockOrigin/uBOL-home/issues/418)).
- **AdGuard**: YouTube's own ad-blocker-detection still breaks playback despite AdGuard running
  (9👍, 48 comments, [AdguardBrowserExtension#2532](https://github.com/AdguardTeam/AdguardBrowserExtension/issues/2532));
  a malformed regex rule can hang the whole browser (7👍, 31 comments,
  [#2240](https://github.com/AdguardTeam/AdguardBrowserExtension/issues/2240)).
- **Brave Shields**: **no one-click way to allow a whole site *and its subdomains* at once** (61👍,
  66 comments, [brave-browser#5290](https://github.com/brave/brave-browser/issues/5290)); Shields
  breaks page fonts/text on some sites (18👍, 69 comments,
  [#23093](https://github.com/brave/brave-browser/issues/23093)); accumulated per-site exceptions
  have no audit/bulk-reset view (9👍, [#10829](https://github.com/brave/brave-browser/issues/10829)).
- **Ghostery**: high memory-usage complaint (13👍, 33 comments,
  [ghostery-extension#481](https://github.com/ghostery/ghostery-extension/issues/481)); sites
  logging users out repeatedly, a false-positive breakage report (60 comments,
  [#43](https://github.com/ghostery/ghostery-extension/issues/43)); request for uBO-style granular
  per-site element blocking (14👍, [#873](https://github.com/ghostery/ghostery-extension/issues/873)).
- **Privacy Badger**: blocks legitimate OAuth/comment-widget flows (Facebook login, Disqus, Google
  OAuth) with named workaround domains, read directly (8👍, 17 comments,
  [privacybadger#137](https://github.com/EFForg/privacybadger/issues/137)); causes CSP violations
  on strict-CSP sites (10👍, 38 comments, [#1793](https://github.com/EFForg/privacybadger/issues/1793)).
- **DuckDuckGo Privacy Essentials**: **wildcard support wanted for the "Unprotected Sites"
  exception list** — current mechanism is exact-domain only (8👍,
  [duckduckgo-privacy-extension#533](https://github.com/duckduckgo/duckduckgo-privacy-extension/issues/533));
  false-positive resource blocking breaking checkout flows (7👍,
  [#471](https://github.com/duckduckgo/duckduckgo-privacy-extension/issues/471)).

**Two real cross-cutting patterns** (each independently evidenced in ≥3 of the six tools):

1. **Exception/allowlist granularity friction.** Brave wants whole-site+subdomain whitelisting in
   one action; DuckDuckGo wants wildcard exceptions; uBO users separately want easier whole-domain
   whitelist shortcuts. This is the strongest, most repeated signal in the whole pass.
2. **Legitimate-flow false positives** (OAuth/comment widgets, fonts, login persistence) — Privacy
   Badger (#137), Ghostery (#43), Brave (#23093). Distinct from the already-documented
   MV3-webRequest-removal story: this is about filter-rule/allowlist precision, not a platform API
   gap.

**A concrete, Moat-specific instance of pattern 1, found by reading the code, not a competitor's
issue tracker**: `isSiteDisabled()` in `src/background/settings.ts` (line 155-158) checks
`settings.disabledSites.includes(hostname)` — **exact hostname match only**. Pausing Moat on
`example.com` does not pause it on `shop.example.com` or `www.example.com`. This is despite the
codebase already containing *three separate, tested* same-or-subdomain matching helpers elsewhere —
`cosmeticSelectors.ts` ("matches a parent domain's selectors when visiting a subdomain"),
`cnameUncloakMatch.ts`, and `redirectDomainMatch.ts` ("matches a subdomain of an entry in the
destination list") — so this isn't a missing capability, it's one list that was never wired to a
pattern the rest of the codebase already uses and tests. (By contrast, `customBlockedDomains`/
`customAllowedDomains` get subdomain coverage for free, since `applyCustomRules.ts` compiles them
into DNR dynamic rules whose own domain-anchor syntax is subdomain-inclusive by construction — only
the plain-array pause list lacks it.)

**Philosophy-fit ratings**, using the same discipline as `ad-blocker-architecture-and-roadmap.md`
§6 (fit tension + rough cost):

1. **Make "Pause on this site" subdomain-aware**, reusing the existing `redirectDomainMatch.ts`-style
   helper. **Fit: very low tension** — this doesn't add a new decision surface, it fixes an
   existing quiet, single-toggle override to actually behave the way a user pausing "the site
   they're on" already assumes it does. **Cost: small** — one function swap plus tests, following
   an already-proven, already-tested in-repo pattern.
2. **A one-click "allow this site and its subdomains" shortcut**, addressing Brave's #5290-shaped
   complaint directly. **Fit: low tension** — it's making an existing per-site decision easier to
   express correctly, not asking the user to decide anything new. **Cost: small**, given item 1's
   groundwork.
3. **An audit/bulk-view of accumulated exceptions** (Brave's #10829-shaped complaint). Moat's
   Settings → Custom Rules tab already lists blocked/allowed sites with per-entry removal — this
   complaint is **already substantially addressed** in Moat relative to Brave's own gap; the only
   plausible addition would be folding the paused-sites list into the same view for one combined
   audit surface. **Fit: very low tension. Cost: small.**
4. **Faster false-positive triage feeding real fixes** (pattern 2: OAuth/widget/login breakage).
   Moat's popup already has a "Report a problem…" button — the pain point most other tools lack
   entirely (a structured, low-friction path to report exactly this). The gap isn't the UI, it's
   whether reports actually get triaged into allowlist/filter fixes fast. **Fit: low tension**
   (already the right shape). **Cost: process, not code** — worth a note that this is a workflow
   question, not an engineering one.
5. **Font-fingerprinting, dark-mode-for-Settings, mobile/Safari ports**: already covered above —
   font-fingerprinting is closed (§2 item 5); dark mode is moot for Moat specifically (already
   dark-only, arguably the mirror-image gap); mobile/Safari ports are a platform/strategy decision
   outside this report's scope, not a feature.

---

## If you build one thing next

**Make "Pause on this site" (and, as a natural follow-on, a same-or-subdomain "allow site" action)
subdomain-aware.** Every other candidate in this report is either already shipped (§2's five items),
already architecturally closed (font-fingerprinting), already substantially covered by an existing
Moat feature (exception auditing via Custom Rules, false-positive reporting via "Report a
problem…"), or genuinely open but expensive/undecided-by-design (DoH CNAME lookup, generic-cosmetic
DOM gating, worker-thread offloading — none trivial, none urgent). This one is different: it is the
single item that is simultaneously (a) directly evidenced by the strongest, most repeated
cross-competitor complaint found in this pass (Brave #5290 at 61👍, DuckDuckGo #533, plus a related
uBO whitelist-shortcut ask), (b) a real, concrete, already-located bug in Moat's own code rather
than a speculative gap, (c) fixable by reusing a pattern the codebase already has, tests, and trusts
in three other places, and (d) zero tension with Moat's "quiet, decide-nothing-by-default"
philosophy — it makes an existing single-toggle decision behave the way users already assume it
does, without adding any new surface, prompt, or setting. Smallest cost, best-evidenced demand, and
zero philosophical risk of the whole list.

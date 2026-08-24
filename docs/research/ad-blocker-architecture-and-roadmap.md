# Ad-Blocker Architecture Landscape and Roadmap Candidates

Researched 2026-08-24. This document surveys how five widely-used ad/tracker-blocking
tools — uBlock Origin (incl. uBlock Origin Lite), AdGuard, Brave Shields, Ghostery,
and Privacy Badger — solve the same MV3-era problems Moat has already solved or is
still facing, using primary sources only (vendor source repos, official docs, and
first-party engineering posts). It does **not** re-describe Moat's existing
architecture; it exists to inform Moat's roadmap by identifying what's genuinely new,
different, or still unsolved industry-wide.

Each section below is one research topic. A closing "Candidates for Moat" section
turns the findings into scoped, citable suggestions.

---

## 1. MV3 blocking-engine architecture across the five tools

### uBlock Origin / uBlock Origin Lite (uBOL)

uBOL is the from-scratch MV3-native rewrite; classic uBlock Origin still runs on
Firefox using MV2 `blockingWebRequest` (see §1 Firefox note below) and, where Chrome
still allows it, an MV2 build. uBOL's own FAQ states it plainly: "There are no filter
lists proper in uBOL. There are declarative rulesets and scripts which are the
results of compiling filter lists when the extension package is generated," and
"uBOL never makes network requests to any remote servers" — everything is baked in at
build time, same philosophy as Moat's build-time DNR compilation. uBOL keeps its
*default* ruleset around 17K rules ("Optimal"/"Complete" modes), and even with every
regional/annoyance/privacy ruleset enabled stays "just slightly above 30K," deliberately
far under Chromium's static-rule ceiling, because the team gave "special attention to
generate the smallest amount of rules when compiling filter lists into rulesets at
extension build time." ([uBOL-home FAQ](https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ)))

uBOL's cosmetic/scriptlet injection is handled by a **Scripting Manager**
(`platform/mv3/extension/js/scripting-manager.js`) that pre-registers content scripts
via `chrome.scripting.registerContentScripts()` — `registerGeneric()` for
generic (site-independent) cosmetic filters and `registerCosmetic()` for
site-specific ones — because MV3 requires content scripts to be registered ahead of
time rather than injected dynamically the way MV2 did. Notably, **generic cosmetic
filtering is off by default** in uBOL's "Optimal" mode and only activates in
"Complete" mode, a direct default-off performance/scope tradeoff Moat has not needed
to make (Moat ships all cosmetic selectors, just sharded by domain hash).
([DeepWiki summary of gorhill/uBlock, cross-referenced against uBOL-home wiki](https://deepwiki.com/gorhill/uBlock/10-ublock-origin-lite-(mv3)))

Classic (non-Lite) uBlock Origin's static network filtering engine uses a flat
typed-array storage model with a token-based dispatch system and a compressed trie
(**HNTrieContainer**) purpose-built for hostname matching: "the hostname labels making
up a hostname are matched from right to left, such that `www.example.org` will be a
match if `example.org` is stored into the trie" and lookup cost scales with the length
of the hostname being matched, not the number of filters in the list — "you could have
tens of thousands of such filters" with no meaningful slowdown. On Firefox, this trie
lookup is compiled to WebAssembly for further speed.
([gorhill/uBlock hntrie.js](https://github.com/gorhill/uBlock/blob/master/src/js/hntrie.js), [Filter Performance wiki](https://github.com/gorhill/ublock/wiki/Filter-Performance))

Cosmetic filtering in classic uBO goes well beyond a plain `<style>` block: it has a
**procedural cosmetic filter** engine (`:has-text()`, `:matches-css()`, `:xpath()`,
`:upward()`, etc., chainable since 1.11.0+) implemented via a `PSelector` task-chain
system in `contentscript-extra.js`, run only when a plain CSS selector can't express
the target. ([Procedural cosmetic filters wiki](https://github.com/gorhill/ublock/wiki/Procedural-cosmetic-filters))
It also does **generic cosmetic filtering** via a DOM surveyor: "a typical generic
cosmetic filter only injects when uBO's DOM surveyor finds at least one matching
element in a web page" — i.e. it scans the live page's actual class/id attributes and
only pulls in the (comparatively few) generic rules that could possibly match, rather
than injecting the full generic set blind. ([Cosmetic filtering in uBlock wiki](https://github.com/uBlockOrigin/uBlock-issues/wiki/Cosmetic-filtering-in-uBlock:-version-0.4.0.0-update))

**Firefox note (applies to uBO, AdGuard, and any MV3 extension there):** Mozilla's
own blog states unambiguously that "Firefox... will continue supporting both
*blockingWebRequest* and *declarativeNetRequest*," explicitly to keep "powerful
privacy tools available to users," in contrast to Chrome's deprecation path.
([Mozilla blog: Firefox's approach to Manifest V3](https://blog.mozilla.org/en/firefox/firefox-manifest-v3-adblockers/))
This means uBO, AdGuard, and Ghostery's Firefox builds can and do keep using classic
webRequest-based blocking on Firefox rather than being forced onto DNR there — a
different constraint shape than Moat currently treats Firefox under (Moat's DNR
rulesets currently target both browsers uniformly per the architecture brief).

### AdGuard

AdGuard was first to publicly claim an MV3-compliant ad blocker
([AdGuard: "the world's first ad blocker built on Manifest V3"](https://adguard.com/en/blog/adguard-mv3.html)).
Their engine `tsurlfilter`/`tswebextension` wraps `declarativeNetRequest` behind a
`configure()` call that returns a structured `ConfigurationResult`, including
`staticFiltersStatus.errors` (e.g. `FailedEnableRulesetsError`) and
`dynamicRules.limitations` for truncation when the 5,000-dynamic-rule ceiling is hit —
i.e. AdGuard's library treats budget overflow as a first-class, inspectable error
condition rather than a silent drop. ([tswebextension README](https://github.com/AdguardTeam/tsurlfilter/blob/master/packages/tswebextension/README.md))
Their blog is candid about the DNR budget fight: Chrome guarantees "30,000 rules per
extension and a total limit of 330,000 rules for all extensions installed by a single
user" combined, so when a user runs AdGuard alongside another rule-heavy extension
"perhaps some of the extensions will fall short of the limit" — the two extensions
compete for one shared global pool. ([AdGuard MV3 blog](https://adguard.com/en/blog/adguard-mv3.html))

For cosmetic rules, AdGuard has a documented ExtendedCSS engine
(`AdguardTeam/ExtendedCss`) supporting `:contains()` (text match against
`textContent`, aliased `:-abp-contains`/`:has-text`), `:matches-css()`, and a
polyfilled `:has()` (aliased `:-abp-has`/`:if`) for browsers that lacked native
`:has` support — directly comparable to uBO's procedural filters, and notably more
powerful than a plain injected `<style>` block. ([ExtendedCss README](https://github.com/AdguardTeam/ExtendedCss/blob/master/README.md))

On scriptlets under MV3: Chrome's Web Store review flagged AdGuard's parameterized
scriptlets as a remote-code-execution policy risk, so **AdGuard hardcoded all
scriptlets directly into the extension bundle** rather than interpreting arbitrary
scriptlet text at runtime, and separately brought back **user-defined** custom filters
by using the new `userScripts` API gated behind Chrome's Developer Mode toggle.
([AdGuard Browser Extension v5.2 blog](https://adguard.com/en/blog/adguard-browser-extension-v5-2.html), [User Scripts API KB](https://adguard.com/kb/adguard-browser-extension/user-scripts-api/))
This is architecturally close to what Moat already refuses to do (arbitrary JS
injection from filter-list text) — AdGuard's answer was "pre-verify and bundle every
scriptlet body at build time, execute only exact matches," the same "no remote code"
posture Moat already holds for its own reasons.

### Brave Shields

Brave Shields is **not a WebExtension at all** — it's compiled directly into Brave's
Chromium fork: "Since Shields are patched directly onto the open-source Chromium
codebase, they don't rely on MV2 *or* MV3... Manifest V3 will not weaken Brave Shields
in any way." ([Brave: What MV3 means for Shields](https://brave.com/blog/brave-shields-manifest-v3/))
This sidesteps every constraint this research topic is about, and is not a model Moat
(a cross-browser extension) can adopt — it's included for completeness/contrast only.

The underlying matching engine, **adblock-rust**, was rewritten from C++ to Rust and
Brave reports a 69x performance improvement. Its trick is **tokenization**: "extracts
alphanumeric substrings from filter rules and hashes each... resulting in numeric
tokens," then "calculates a histogram of token popularity across all network filters
and for each rule chooses the *least popular* token as the one identifying the rule" —
this is a classic inverted-index / rarest-token bucketing strategy that avoids
bucketing rules under high-frequency tokens like `com` or `net`. Matching happens in
four ordered phases (important rules, then redirects, then remaining filters, then
exceptions) for early short-circuiting.
([Brave: Improved ad-blocker performance](https://brave.com/blog/improved-ad-blocker-performance/))

adblock-rust's cosmetic filtering also avoids shipping every generic selector to
every page: it keeps `simple_class_rules`/`simple_id_rules` hash sets plus
`complex_class_rules_index`/`complex_id_rules_index` hash maps keyed by class/id
name, so "rather than injecting all of these rules onto every page, which would blow
up memory usage, we only inject rules based on classes and ids that actually appear
on the page" — as new classes/ids appear (via mutation observer on the page side) the
engine does an O(1) hash lookup rather than scanning a selector list.
([brave/adblock-rust cosmetic_filter_cache.rs](https://github.com/brave/adblock-rust/blob/master/src/cosmetic_filter_cache.rs))
This is conceptually different from Moat's per-domain shard hashing: adblock-rust
shards by **DOM content actually observed**, not by **domain name**, which sidesteps
the "which of my 64 buckets does this domain fall into" approximation entirely for
generic rules. It still needs a per-domain index for hostname-specific selectors.

### Ghostery

Ghostery's JS-based engine (`@ghostery/adblocker`, formerly `@cliqz/adblocker`) "keeps
parsed filter lists in memory and runs a JavaScript match on every request" and their
own 2019 performance study reportedly found "the overhead is in the sub-millisecond
range" — used rhetorically in their MV3 pushback blog to argue Google's stated
performance rationale for MV3 doesn't hold up.
([Ghostery: Manifest V3 - Improving Privacy?](https://www.ghostery.com/blog/manifest-v3-privacy))
Their MV3-perspective post lays out a genuinely different strategy from uBO/AdGuard:
because DNR can't do the *dynamic, data-driven* request modification Ghostery's
tracker-protection relies on (stripping identifying params, not just block/allow),
they describe intending to **replace built-in browser APIs like `fetch` from a content
script** ("monkey-patching") to claw back some of that dynamism, explicitly
acknowledging this "introduces site-breakage risks and latency" — a materially
riskier approach than either DNR-only or Moat's design philosophy would accept.
([Ghostery: Manifest V3 - the Ghostery Perspective](https://www.ghostery.com/blog/manifest-v3-the-ghostery-perspective))
Ghostery's public GitHub issue asking whether the core `adblocker` library itself has
MV3 migration plans (#2961, opened Dec 2022) was closed with no team response
recorded, so — unlike uBO/AdGuard — there is **no public primary-source architecture
doc** for how the core matching library itself was adapted to MV3; only the shipped
extension's blog-level commentary exists.
([ghostery/adblocker issue #2961](https://github.com/ghostery/adblocker/issues/2961))

### Privacy Badger

Privacy Badger is architecturally the outlier: it's not filter-list-driven at all — it
heuristically learns which third-party domains behave like trackers by observing
requests across sites (cookies/localStorage used cross-site plus canvas fingerprinting
signals), which is fundamentally a `webRequest`-observation-heavy model. EFF's own
position is blunt: MV3 "removes the ability to redirect requests using the flexible
webRequest API that Privacy Badger uses," replacing it with DNR, which is "limited by
design," and EFF explicitly says "MV3 extensions are not able to properly fix
redirects at the network layer at this time" and wants that gap closed before MV3
becomes mandatory everywhere.
([EFForg/privacybadger issue #2273](https://github.com/EFForg/privacybadger/issues/2273); [EFF: New Privacy Badger Prevents Google From Mangling More of Your Links](https://www.eff.org/deeplinks/2023/09/new-privacy-badger-prevents-google-mangling-more-your-links-and-invading-your))

Privacy Badger shipped an MV3-compatible rewrite in 2024, and made a notable **default
behavior change** as part of it: heuristic learning ("block new trackers it discovers
live") is no longer on by default — it now ships pre-trained from EFF's own automated
testing and defaults to *not* learning live, because live learning "can be exploited
by third parties to fingerprint the user based on trackers it blocks." Live learning
remains available as an opt-in.
([Privacy Badger doc/Changelog](https://github.com/EFForg/privacybadger/blob/master/doc/Changelog); cross-referenced via search results citing the 2024 changelog entries)
This is a directly relevant precedent for any future heuristic/adaptive feature Moat
might consider: making learned-state itself a fingerprinting vector is a real,
previously-shipped failure mode, not a hypothetical one.

---

## 2. CNAME uncloaking

uBlock Origin's CNAME uncloaking is **Firefox-only**, and it is Firefox-only for a
concrete, sourced reason: it depends on the `browser.dns.resolve()` WebExtension API
(documented at [MDN: dns.resolve()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/dns/resolve)),
which **Chrome does not implement at all** — there is no equivalent API surface for an
extension to request the DNS record for a hostname; a search of uBO's own wiki
confirms the feature ties directly to that API and that it caches
alias→CNAME associations to reduce the number of resolve calls.
([uBlock Origin works best on Firefox wiki](https://github.com/gorhill/uBlock/wiki/uBlock-Origin-works-best-on-Firefox))
A known caveat even on Firefox: CNAME uncloaking silently fails when DNS-over-HTTPS is
enabled in the browser, because the `dns.resolve()` API path doesn't go through the
DoH resolver the same way regular navigation does.
([uBlockOrigin/uBlock-issues #1190](https://github.com/uBlockOrigin/uBlock-issues/issues/1190))
**Conclusion: none of uBO/AdGuard/Ghostery solve this on Chrome.** It is a hard
platform-API gap, exactly as Moat's own gap analysis already concluded — this
research did not surface any Chrome-side extension workaround from any of the five
tools.

The one real solution in the wild is **not a browser extension at all**: NextDNS, a
DNS resolver product, does uncloaking at the DNS layer where it has visibility into
every intermediate CNAME in a resolution chain: "NextDNS applies all your blocklists
to each intermediate CNAME in addition to the queried domain name." They also publish
an open **CNAME cloaking destination blocklist** — domains known to be used
specifically as CNAME-cloak targets (Criteo, Adobe, Commanders Act, etc.) — as a
public, freely reusable list.
([nextdns/cname-cloaking-blocklist](https://github.com/nextdns/cname-cloaking-blocklist), [domains file](https://github.com/nextdns/cname-cloaking-blocklist/blob/master/domains))
This list is a genuinely adoptable primary source: Moat can't resolve CNAMEs itself
on Chrome, but it *could* ship NextDNS's list of known-cloak-destination domains and
treat any request whose apparent first-party hostname's registrable domain doesn't
match the page's origin AND which resolves (via a DoH fetch Moat performs itself, see
below) into one of those destinations as blockable — this is a heuristic approximation,
not true uncloaking, but it's the same class of solution NextDNS itself productized.

A note on the DoH angle: nothing in NextDNS's own material suggests a *browser
extension* can replicate their approach without either (a) an actual DNS-layer
vantage point (which extensions don't have) or (b) the extension itself issuing a DoH
query for the hostname before/alongside the request and reading the CNAME chain out of
the DoH JSON response — which is technically possible from a background service worker
via `fetch()` to a DoH endpoint (e.g. Cloudflare's `1.1.1.1/dns-query`), but no primary
source among the five tools documents doing this, and it introduces new problems Moat
would need to solve itself (which DoH provider to trust/hardcode, added per-request
latency, and sending every hostname you visit to a third-party resolver — a privacy
tradeoff in service of a privacy feature).

---

## 3. Cookie-banner handling without scriptlet execution

**Consent-O-Matic** (CAVI, Aarhus University) is exactly the kind of declarative,
non-arbitrary-JS model this research was asked to look for. Its rules are pure JSON,
structured around three concepts:

- **Detectors**: CSS-selector-based checks for whether a given CMP (consent
  management platform) is present/visible on the page.
- **Methods**: named, ordered sequences of actions (`HIDE_CMP`, `OPEN_OPTIONS`,
  `DO_CONSENT`, `SAVE_CONSENT`) run when a detector fires.
- **Actions**: a small fixed vocabulary — `Click`, `List`, `Consent`, `Slide`,
  `IfCSS`, `WaitForCSS`, `ForEach`, `Wait`, `Hide`, `Close` — each of which targets
  elements via CSS selectors with optional text/style/display filters.

([cavi-au/Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic))

The critical distinction from AdGuard's scriptlet model: a Consent-O-Matic "rule"
cannot contain arbitrary executable code at all — it can only ever compose from that
fixed, audited action vocabulary that ships inside the extension itself. The
extension's own interpreter (not the rule author) is the only thing that ever
executes JS; the rule payload is inert data describing *which selector to click*, not
*what code to run*. That is a materially different trust boundary than "pre-verify
and hardcode every scriptlet body," which is AdGuard's MV3-era compromise (§1) — with
Consent-O-Matic's model there is no scriptlet body to verify because there's no
scriptlet, only declarative actions over a small closed action-type enum. This maps
onto Moat's existing philosophy ("no arbitrary JS injection from filter lists")
without requiring Moat to invent a new engine from scratch — Consent-O-Matic's rule
format and its ~selector-only action set already exists as a reusable pattern (its
rule packs are themselves openly licensed JSON in the same repo).

For contrast, the "I don't care about cookies" project (acquired by Avast) ships both
a filter list *and* a dedicated extension; its own author acknowledges the filter-list
form is strictly weaker: "the filter list is not as effective as a browser extension
but it will hide most cookie warnings" — i.e. selector-only hiding (what Moat already
does) catches the easy banners, but their own extension needs actual button-clicking
logic (comparable to Consent-O-Matic's action model) for the harder ones, including
banners with no clean "reject" CSS hook and mentioned specifically for sites like
YouTube.
([HN discussion quoting the project](https://news.ycombinator.com/item?id=32853841); [gist of the CSS-only rule subset](https://gist.github.com/anthonydillon/b77351b8266a777dc5ef8489d5f7df45))

---

## 4. Font-fingerprinting resistance techniques

Two real, documented, and materially different approaches exist:

**Tor Browser: font allowlist (Mozilla bug 1121643, landed in Gecko/Tor Browser).**
The approach adds a `font.system.whitelist` preference: a comma-separated list of
approved font family names, applied at the `gfxPlatformFontList` level during font
enumeration so **non-whitelisted fonts are removed from the available font table
entirely**, not merely reported inconsistently. `src: local()` CSS font references are
also blocked outright to prevent a page from probing for a specific named local font
via `@font-face` as a side channel around the enumeration allowlist. The tradeoffs are
explicit in the bug thread: if the whitelisted font set doesn't cover a script/language
a page needs, text renders as literal hexboxes (Wikipedia in various languages was the
specific breakage test case used), and the platform-specific font-fallback mechanism
had to be specially modified to fall back to *generic* families instead of bypassing
the whitelist through normal substitution logic. Tor's own support docs summarize the
overall philosophy this sits inside: some browser attributes "are necessary for
functionality and cannot be completely hidden or spoofed. Instead, Tor Browser limits
the variety within these attributes to reduce distinctiveness" — i.e. normalize
everyone down to the same small font set rather than hide the set.
([Mozilla bug 1121643](https://bugzilla.mozilla.org/show_bug.cgi?id=1121643); [Tor Browser fingerprinting-protections support page](https://support.torproject.org/tor-browser/features/fingerprinting-protections/))

**Brave: font-enumeration protection is *not yet a full allowlist/farbling
solution*.** Brave's canvas/audio/WebGL noise-injection ("farbling") system is
implemented and documented, but Brave's own privacy-updates post is explicit that,
at time of that writing, font fingerprinting sat in the "in development" column
alongside GPU-string minimization: "we have in-development plans to address
font-enumeration based fingerprinting." A *separate*, later search result (an open
brave-browser GitHub issue titled "Only use a subset of user-installed fonts to
farble," #34043) and a gHacks report describe a subsequent, shipped Brave behavior:
Brave allows all web fonts and all OS fonts for the user's current top language, but
exposes only a **randomly-selected (farbled) subset of *user-installed* fonts** rather
than the full installed set — this is a hybrid: allowlist-like for OS/web fonts
(always shown, not a fingerprinting-relevant signal by design) plus per-install
randomization for the more identifying user-installed-fonts category. Brave documents
this is enabled on Windows/macOS/Android but explicitly **not** applied on Linux
("difficulties in determining which fonts are 'OS fonts' for each distro") or iOS
(platform restrictions).
([Brave privacy-updates: Fingerprinting defenses 2.0](https://brave.com/privacy-updates/4-fingerprinting-defenses-2.0/); [brave/brave-browser issue #34043](https://github.com/brave/brave-browser/issues/34043))

**Tradeoff summary, both sourced from the above:**
- *Allowlist (Tor's approach)*: strongest guarantee (non-whitelisted fonts are
  provably invisible to the page, not just harder to detect statistically), but
  higher breakage risk — pages that need a script/language outside the bundled set
  render broken text, and the fallback logic needs surgery to avoid leaking the real
  font set through substitution behavior.
- *Randomization/noise (Brave's per-install farbled subset)*: lower breakage risk
  (real installed fonts still render, just an inconsistent-across-sessions subset is
  exposed) but a weaker guarantee — it raises the cost/reliability of fingerprinting
  rather than eliminating the signal, and Brave's own admission that the technique
  isn't ported to Linux shows the platform-detection cost of doing it well.

---

## 5. MV3-era performance techniques for filter/cosmetic delivery beyond domain-hash sharding

- **Class/id-content-driven cosmetic sharding (adblock-rust).** Covered in depth in
  §1: rather than sharding generic cosmetic selectors by *domain*, adblock-rust shards
  by the *actual class/id tokens present on the page*, via hash-set/hash-map lookups
  (`simple_class_rules`, `complex_class_rules_index`, etc.) as new tokens are
  discovered on the live DOM. This is a genuinely different axis from Moat's per-domain
  hash bucketing and specifically solves the "generic filters" case — rules with no
  associated hostname at all — which domain-hash sharding doesn't help with, since a
  generic rule has to live in *every* domain's bucket or be handled separately.
  ([brave/adblock-rust cosmetic_filter_cache.rs](https://github.com/brave/adblock-rust/blob/master/src/cosmetic_filter_cache.rs))

- **DOM-surveyor gating for generic cosmetic filters (uBO).** uBO only *injects* a
  generic cosmetic filter once its DOM surveyor confirms a matching element actually
  exists on the current page, rather than shipping the full generic rule set to the
  page unconditionally. ([Cosmetic filtering in uBlock: 0.4.0.0 update](https://github.com/uBlockOrigin/uBlock-issues/wiki/Cosmetic-filtering-in-uBlock:-version-0.4.0.0-update))

- **Rarest-token inverted-index bucketing for network filters (adblock-rust).**
  Instead of hashing the whole domain, adblock-rust hashes alphanumeric substrings out
  of each filter rule and buckets each rule under its *least frequent* token (by a
  precomputed popularity histogram across the whole ruleset), so a URL is checked only
  against the handful of buckets its own rare substrings could plausibly hash into —
  this is the same "narrow the candidate set before doing real matching" idea as
  domain-hash sharding, but computed over rule *content* instead of the *domain name*,
  and is reported to contribute materially to Brave's 69x speedup.
  ([Brave: Improved ad-blocker performance](https://brave.com/blog/improved-ad-blocker-performance/))

- **Compressed hostname trie + WASM lookup (uBO's HNTrieContainer).** Pure-hostname
  filters (a huge fraction of any large blocklist) are stored in a purpose-built,
  memory-compact trie matched right-to-left by label, giving lookup cost proportional
  to the length of the hostname being checked rather than the size of the filter set —
  and on Firefox this trie-walk is compiled to WebAssembly.
  ([hntrie.js](https://github.com/gorhill/uBlock/blob/master/src/js/hntrie.js); [Filter Performance wiki](https://github.com/gorhill/ublock/wiki/Filter-Performance))

- **Build-time rule minimization as an explicit, tracked design goal (uBOL).**
  uBOL's team treats "smallest possible compiled ruleset" as an active engineering
  target during the filter-list→DNR compile step, not an afterthought — worth noting
  because it's the same build-time-compile step Moat already has, just with an
  explicit size-minimization pass Moat's brief doesn't currently describe having.
  ([uBOL-home FAQ](https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ)))

No primary source among the five tools documents using a **Bloom filter** by that
name for request or cosmetic matching (adblock-rust's token-popularity histogram
approach is a related but distinct technique — an inverted index with rarest-token
selection, not a probabilistic set-membership structure), nor did any surfaced
primary source describe caching fetched filter/cosmetic shards in **IndexedDB** —
uBOL and AdGuard both lean on bundling everything into the extension package at build
time specifically to avoid needing a runtime fetch-and-cache step at all, which is
also Moat's existing bundled-shard model.

---

## 6. Notable features Moat has no equivalent of

For each: what it is, its primary source, and whether it sits comfortably inside
Moat's stated "quiet, decide-nothing-for-the-user-by-default" philosophy or creates
tension with it.

1. **uBO's network-request logger / "the logger."** A live, per-tab inspector
   showing every request uBO saw, whether it was blocked/allowed, and which specific
   filter rule matched — "the tool of choice to see, understand, diagnose and fix the
   functioning of uBO." ([The logger wiki](https://github.com/gorhill/uBlock/wiki/The-logger))
   **Fit:** Low tension — this is a diagnostic tool for power users/developers, not a
   decision surfaced to ordinary users by default. It's opt-in-to-open (a dashboard
   panel), doesn't nag, and directly supports Moat's own maintainability (e.g.
   diagnosing the YouTube-dimmer or feed-scanner heuristics breaking silently, both
   named as known Moat weaknesses).

2. **uBO's Element Zapper** (distinct from the element picker Moat already has).
   One-click, non-persistent element removal ("stays hidden until you reload the
   page") with no filter created — pure "make this go away right now" with zero
   storage/decision-making implied. ([Element zapper wiki](https://github.com/gorhill/ublock/wiki/Element-zapper))
   **Fit:** Very low tension — arguably *more* aligned with "decide nothing for the
   user by default" than Moat's existing "Hide for now," since it makes no
   filter-generation choice at all, just a DOM removal. Moat's brief describes an
   equivalent "Hide for now" already, so this is closer to a naming/UX nuance than a
   net-new feature — worth confirming Moat's version has zero persistence, matching
   uBO's.

3. **Privacy Badger's click-to-activate widget replacement.** Rather than simply
   hiding embedded trackers wholesale (social share buttons, embedded video/comment
   widgets), Privacy Badger blocks the tracking load by default and swaps in an inert
   placeholder the user can click to actually load the real widget, accepting the
   tracking exposure just for that one interaction: "click-to-activate replacements
   for potentially useful trackers (video players, comments widgets, etc.)... You
   will not be tracked by these replacements unless you explicitly choose to click
   them." ([Privacy Badger FAQ: social media widgets](https://github.com/EFForg/privacybadger-website/blob/master/content/en/faqs/How-does-Privacy-Badger-handle-social-media-widgets.md))
   **Fit:** Some tension, worth flagging rather than pre-filtering out. It's not a
   nag screen and it doesn't ask the user to decide anything up front (block-by-default,
   click-to-override is itself a quiet default), but it does require Moat to
   maintain a per-widget-type placeholder catalog (Facebook Like button, YouTube
   embed, Disqus, etc.) and per-site markup detection to know *what* to replace with
   *which* placeholder — meaningfully more surface area and breakage risk than a pure
   hide-or-don't-hide rule, closer in spirit/cost to the Instagram Stories problem
   Moat already deliberately declined to build.

4. **Ghostery's TrackerDB / company attribution.** A structured, openly-licensed
   database mapping tracking domains/patterns to the actual organizations that run
   them and to categories (advertising, site analytics, consent management, etc.),
   consumed both by the Ghostery extension (to label *who* is tracking you, not just
   *that* something was blocked) and published separately as WhoTracks.me, "the
   world's largest statistical report on tracking online."
   ([ghostery/trackerdb README](https://github.com/ghostery/trackerdb/blob/main/README.md); [Introducing TrackerDB](https://www.ghostery.com/blog/introducing-trackerdb))
   **Fit:** Low tension, genuinely additive. This is purely informational — it
   doesn't ask the user to decide anything, it just gives Moat's existing
   Ads/Trackers/Popups toolbar breakdown a "which company" drill-down instead of a
   bare count, which is a natural, quiet extension of a feature Moat already ships
   (real block-count breakdown via `getMatchedRules()`). Licensing is CC-BY-NC-SA-4.0
   ("free to use for non-commercial purposes"), which Moat would need to check
   against its own licensing model before adopting the data directly.

5. **Brave Shields' per-site granular toggle panel.** A toolbar panel scoped to the
   current site that lets a user turn Shields off entirely *for this site only*, or
   drill into "Advanced controls" to flip individual categories (trackers/ads,
   cookies, fingerprinting, etc.) just for that site, with the change applying only
   to the site in focus. ([Brave Help Center: global and site-specific Shields settings](https://support.brave.app/hc/en-us/articles/360023646212-How-do-I-configure-global-and-site-specific-Shields-settings))
   **Fit:** Real tension, and the brief specifically asks to flag rather than
   pre-filter. Moat already has global filtering-level presets and per-list toggles,
   but nothing scoped to "this one site, this one category, without touching global
   settings" — that's a meaningfully different UI surface (an always-available
   per-site override panel) than a settings page, and if built naively could drift
   toward exactly the "decide something for the user" surface area Moat's philosophy
   avoids. It's also the most-requested-shaped feature (every major blocker has some
   per-site override), so the tension is worth resolving deliberately rather than by
   default-avoiding it.

6. **uBO's per-site dynamic-filtering "firewall matrix."** A much heavier-weight
   version of #5: a full matrix UI letting an "advanced user" (gated behind an
   explicit "I am an advanced user" toggle) set global vs. per-site allow/block rules
   down to the level of individual third-party domains contacted by the current page.
   ([Dynamic filtering: quick guide](https://github.com/gorhill/uBlock/wiki/dynamic-filtering:-quick-guide); [Tutorial: unbreak a site using the dynamic filtering pane](https://github.com/gorhill/uBlock/wiki/Tutorial:-how-to-unbreak-a-site-using-the-dynamic-filtering-pane))
   **Fit:** High tension with Moat's stated philosophy as written, and worth naming
   explicitly as a **non-candidate**: this is real decision-delegation to the user at
   a granularity ("should this one third-party domain be allowed on this one site")
   that runs directly against "decide nothing for the user by default, quiet." uBO
   itself gates it behind an explicit opt-in advanced mode for the same reason. Only
   worth reconsidering if Moat's philosophy itself changes.

7. **Anti-adblock-detection countermeasures.** Multiple filter-list-based projects
   (an "AdGuard Anti-Circumvention"-style list, community "anti-adblock" filter
   packs) exist specifically to defeat sites that detect an ad blocker is active and
   respond with a nag wall or degraded content — but this research could not locate
   a first-party engineering writeup (from AdGuard, uBO, or the community list
   maintainers) describing the *technical mechanism* beyond "more filter rules
   targeting the detection scripts/markup," i.e. it appears to be filter-list content,
   not a distinct architectural feature. ([FilterLists directory](https://filterlists.com/); community list repos surfaced in search, no first-party mechanism doc found)
   **Fit:** Directly aligned with Moat's philosophy (it's exactly "quietly keep
   blocking working," the opposite of a nag), but flagged here as **evidence-limited**
   per the research brief's instruction to say plainly when no primary source could be
   found for a claim — Moat's existing 11 AdGuard filter lists may already include
   anti-circumvention rules implicitly; that would need to be checked against the
   actual list contents, not assumed from this research.

---

## Candidates for Moat

Concrete, scoped suggestions only — each tagged with backing source(s) and a rough
implementation-cost estimate.

1. **Ship AdGuard's bundled `$redirect` resource files (noopjs, 1x1-transparent.gif,
   click2load.html, etc.) to stop dropping the ~990 `$redirect` rules.** AdGuard's
   `Scriptlets` package already publishes exactly this set of no-op resource files as
   `dist/redirects.yml`, and `@adguard/dnr-rulesets` bakes web-accessible-resource
   paths pointing at them directly into the compiled DNR rules. Moat already consumes
   `@adguard/dnr-rulesets` for its 11 lists — closing this gap may be closer to
   "bundle the resource files this package already ships and wire up
   `web_accessible_resources`" than building anything new.
   Source: [AdguardTeam/Scriptlets](https://github.com/AdguardTeam/Scriptlets), [npm @adguard/scriptlets](https://www.npmjs.com/package/@adguard/scriptlets).
   **Cost: small.**

2. **Adopt NextDNS's public CNAME-cloak-destination list as a heuristic (not true
   uncloaking) signal.** Moat can't resolve CNAMEs on Chrome (confirmed no-solution
   gap, §2), but NextDNS's openly licensed list of known cloak-*destination* domains
   could be cross-referenced against Moat's existing tracker-domain matching without
   needing DNS access at all, if Moat is willing to also treat matches against that
   destination list as tracker-equivalent wherever it can otherwise infer a CNAME
   relationship (e.g. via a self-issued DoH lookup, see item 3). As a standalone list
   addition with no DoH component, this is low-risk and directly usable today.
   Source: [nextdns/cname-cloaking-blocklist](https://github.com/nextdns/cname-cloaking-blocklist).
   **Cost: small** (list-only) **to medium** (if paired with self-issued DoH lookups
   per item 3).

3. **(Exploratory, flag for a design decision, not a default-yes) Background-worker
   DoH lookup for CNAME uncloaking on Chrome.** No primary source among the five
   tools documents an extension doing this, but it's technically available: a
   service worker can `fetch()` a DoH endpoint for a hostname before/alongside
   allowing the request and read the CNAME chain from the JSON response, then apply
   NextDNS's or Moat's own tracker-domain rules to the resolved target. This
   introduces real tradeoffs Moat needs to decide on deliberately: which DoH
   provider to hardcode/trust, added per-navigation latency, and sending every
   visited hostname to a third-party resolver as a side effect of a privacy feature.
   Source: derived from NextDNS's DNS-layer approach ([NextDNS CNAME cloaking write-up](https://medium.com/nextdns/cname-cloaking-the-dangerous-disguise-of-third-party-trackers-195205dc522a)) plus MDN's `dns.resolve()` docs confirming no Chrome-native equivalent exists ([MDN dns.resolve()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/dns/resolve)).
   **Cost: medium**, plus a genuine product/privacy tradeoff decision before starting.

4. **Adopt Consent-O-Matic's declarative action model (or its rule packs directly)
   for cookie-banner auto-rejection, instead of AdGuard's scriptlet model.** This
   directly closes Moat's documented gap #3 without violating "no arbitrary JS
   injection from filter lists" — Consent-O-Matic's rules are inert JSON over a
   fixed, small action vocabulary (Click/Hide/WaitForCSS/etc.) interpreted by
   Moat's own bundled code, the same trust boundary Moat already accepts for its
   cosmetic selectors. Moat could either vendor Consent-O-Matic's existing rule
   packs (openly licensed, in-repo) or write a much smaller interpreter for just the
   subset of action types needed to cover the sites its plain-selector approach
   currently misses.
   Source: [cavi-au/Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic).
   **Cost: medium.**

5. **Font-fingerprinting resistance: adopt Brave's hybrid model
   (full OS/web fonts + randomized subset of user-installed fonts) rather than a
   Tor-style hard allowlist.** Given Moat's fingerprint-resistance feature is already
   opt-in and already uses per-install deterministic noise for canvas/audio/WebGL
   (the same design language as farbling), a randomized-subset approach for
   user-installed fonts fits the existing pattern with much lower breakage risk than
   Tor's allowlist-and-hexbox-fallback approach, at the cost of being a weaker
   guarantee (statistical, not absolute). Note Brave's own admission that Windows/macOS
   were solved first and Linux was skipped as genuinely hard ("difficulties in
   determining which fonts are 'OS fonts' for each distro") — Moat should scope this
   per-OS from the start rather than promise uniform coverage.
   Source: [Brave: Fingerprinting defenses 2.0](https://brave.com/privacy-updates/4-fingerprinting-defenses-2.0/), [brave/brave-browser #34043](https://github.com/brave/brave-browser/issues/34043).
   **Cost: medium to large** (font enumeration APIs and per-OS "which fonts are
   OS-level vs user-installed" detection is real platform-specific work).

6. **Shard/gate *generic* cosmetic filters by DOM content observed on the page,
   not just by domain-hash bucket.** Moat's existing domain-hash sharding handles
   hostname-*specific* selectors well, but generic (no-hostname) rules don't have a
   natural home in a per-domain bucket scheme — they either have to live in every
   bucket or be handled as a separate always-loaded set. adblock-rust's
   class/id-hash-map approach (only pull in a generic rule once its class/id
   actually appears in the live DOM) and uBO's DOM-surveyor gating both solve this
   more precisely than "ship all generics to every page," which is presumably what
   Moat does today for the generic subset of its selector set.
   Source: [brave/adblock-rust cosmetic_filter_cache.rs](https://github.com/brave/adblock-rust/blob/master/src/cosmetic_filter_cache.rs), [uBO Cosmetic filtering: 0.4.0.0 update](https://github.com/uBlockOrigin/uBlock-issues/wiki/Cosmetic-filtering-in-uBlock:-version-0.4.0.0-update).
   **Cost: medium** (requires a page-side observer feeding class/id tokens back to
   the selector-selection logic, more moving parts than the current static bucket
   fetch).

7. **Add a lightweight per-tab request/rule inspector ("logger"), scoped as a
   diagnostic/debug surface, not a user-facing decision panel.** Directly modeled on
   uBO's logger: shows which of the 273K compiled rules matched a given request and
   why. This would materially help debug Moat's own already-flagged fragile
   heuristics (YouTube ad-dimmer's two DOM signals, the feed scanner's text-node
   matching) when they break silently after a site markup change, without
   introducing any new default-on UI or decision surface for ordinary users.
   Source: [uBO: The logger](https://github.com/gorhill/uBlock/wiki/The-logger).
   **Cost: small to medium** (Chrome exposes `declarativeNetRequest.getMatchedRules()`
   already, per Moat's existing block-count feature — the main new work is a UI and
   wiring live cosmetic/heuristic-match events through to it; Firefox parity is
   blocked on the same missing API Moat's block-count feature already accepts as a
   Chrome-only limitation).

8. **Add optional company/tracker attribution to the existing block-count
   breakdown, sourced from Ghostery's TrackerDB.** Moat already shows real
   Ads/Trackers/Popups counts; TrackerDB would let a future version label *which
   company* (Google, Meta, Criteo, etc.) a given blocked request belonged to, purely
   informational, no new decision asked of the user. License is
   CC-BY-NC-SA-4.0 (non-commercial only) — needs a licensing check against however
   Moat is distributed/monetized before adoption.
   Source: [ghostery/trackerdb](https://github.com/ghostery/trackerdb/blob/main/README.md).
   **Cost: small** (data integration) **but blocked on a licensing decision first.**

9. **Explicitly decline uBO's per-site dynamic-filtering firewall matrix and
   Ghostery's `fetch`-monkey-patching approach as roadmap items**, on philosophy
   grounds rather than technical infeasibility — both are real, shipped, sourced
   techniques (§1, §6 item 6) but both directly conflict with "decide nothing for
   the user by default" (the firewall matrix) or "no injected behavioral changes to
   page JS beyond what's already scoped" (Ghostery's fetch-patching, which is a
   materially bigger trust/breakage step than Moat's existing `window.open` wrapper).
   Recording this as a deliberate non-candidate, the way Moat already did for
   Instagram Stories, seems more useful than silence.
   **Cost: n/a (decision only).**

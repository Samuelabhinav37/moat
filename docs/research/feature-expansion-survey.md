# Feature-Expansion Survey: Beyond Ad-Blocking, Tracking-Protection, and VPN

Researched 2026-08-25. This document surveys the privacy/security browser-extension
feature space **outside** the three areas Moat's other research docs already cover —
ad/tracker-blocking architecture ([ad-blocker-architecture-and-roadmap.md](./ad-blocker-architecture-and-roadmap.md))
and proxy/VPN feasibility ([vpn-and-secure-connection-feasibility.md](./vpn-and-secure-connection-feasibility.md))
— using primary sources only (the cited products' own docs, GitHub repos, or official
support/developer pages, fetched and read directly). It does **not** re-research
ad-blocking, tracking-protection, uBlock Origin's firewall matrix, or VPN/proxy
mechanics, all covered elsewhere. It also does **not** cover Gmail-specific spam/promo
cleanup, which a separate, parallel research effort is handling
([gmail-cleaner-feasibility.md](./gmail-cleaner-feasibility.md)).

Each section below is one research topic, ending with an explicit, skeptical verdict:
whether the feature fits inside a WebExtension's actual capability envelope (the same
`storage`/`alarms`/content-script/`declarativeNetRequest` surface Moat already uses) or
requires something outside it (a server, an account system, a native host, elevated OS
permissions), and roughly how large a lift it would be for one maintainer. A closing
"Candidates for Moat" section turns the findings into scoped, tagged suggestions,
including explicit declines where a feature is real and buildable but doesn't fit
Moat's "decide nothing for the user by default, quiet" philosophy — or is simply
redundant with something the browser itself already does.

---

## 1. Breach and leaked-credential checking

### Firefox Monitor / Mozilla Monitor

Mozilla's own 2018 announcement is explicit about both the mechanism and the
partnership: Firefox Monitor is "a free service that notifies people when they've been
part of a data breach," built through "our partnership with Troy Hunt's 'Have I Been
Pwned'" — a user's email address, entered at the service's website, is "scanned against
a database that serves as a library of data breaches."
([Mozilla Blog: Introducing Firefox Monitor](https://blog.mozilla.org/blog/2018/09/25/introducing-firefox-monitor-helping-people-take-control-after-a-data-breach/))
Critically, **this is not a Firefox browser built-in feature at all** — it is a
standalone website (now `monitor.mozilla.org`) a user visits directly: "Using just your
email address, we search for you across all known data breaches," with free monitoring
for up to 5 email addresses.
([Mozilla Monitor: How it works](https://monitor.mozilla.org/en/how-it-works))
There is no WebExtension API surface involved on Mozilla's side at all — this is
consumer-facing infrastructure (a hosted web service plus a subscription/alerting
pipeline) sitting entirely outside the browser, not a precedent for what an extension
itself can do unassisted.

### HIBP's own APIs: two very different privacy models

HIBP publishes two materially different APIs, and the difference matters directly for
whether Moat could safely build something like this itself.

**Pwned Passwords (k-anonymity, no auth, no cost).** HIBP's own API docs describe the
mechanism precisely: a client sends only "the first 5 characters of either a SHA-1 or
an NTLM hash," and the API returns "the *suffix* of every hash beginning with the
specified prefix, followed by a count of how many times it appears in the data set" — a
typical response set is "approximately 800 hash suffixes," and the actual
match-or-no-match determination happens **locally**, in the caller's own code, by
scanning the returned suffix list for the remaining 35 characters of the full hash.
([HIBP: Pwned Passwords](https://haveibeenpwned.com/Passwords); [HIBP API v3](https://haveibeenpwned.com/API/v3))
This is k-anonymity in the literal, textbook sense: HIBP's servers only ever see a
5-character hash prefix shared by (on average) hundreds of other passwords, never the
password or its full hash. The API docs state plainly: **"There is no authorisation
required for the free Pwned Passwords API"** and **"There is no rate limit on the
Pwned Passwords API."** An optional `Add-Padding: true` request header further "pads
out responses to ensure all results contain a random number of records between 800 and
1,000," specifically to prevent a network observer from fingerprinting which password
was checked by response size. ([HIBP API v3](https://haveibeenpwned.com/API/v3))
This is a genuinely no-server, no-account, no-secret-key API — directly callable from
an extension's background service worker via `fetch()`, exactly the shape of network
call Moat's own architecture already makes for filter-list updates.

**Breach search by email (`breachedAccount`) — not the same privacy property.** HIBP's
own docs are explicit that the standard breach-lookup endpoint sends the real value:
the request is `GET /breachedAccount/{email address}`, and "this passes the full
address via the URL path and discloses it to HIBP." This endpoint (and the domain-
search and paste-search endpoints) requires an API key: **"Authorisation is required
for all APIs that enable searching HIBP by email address or domain."** Rate limiting
and pricing are tied to a paid subscription — Core tier starts at $4.39/month
(billed annually), and per-tier request-per-minute caps apply; there is no free tier
for this endpoint. ([HIBP API v3](https://haveibeenpwned.com/API/v3); [HIBP: Find the Right Plan](https://haveibeenpwned.com/Subscription))
Notably, HIBP has since added a k-anonymity-shaped variant of this endpoint too —
`GET /breachedaccount/range/{first 6 chars of SHA-1 hash}` — but it is gated behind the
**Pro** or **High RPM** subscription tiers only, not Core, and not free: Pro plans
start at $379/month (billed annually as $4,548/year).
([HIBP API v3](https://haveibeenpwned.com/API/v3); [HIBP: Find the Right Plan](https://haveibeenpwned.com/Subscription))
So while HIBP *has* extended the k-anonymity privacy model to email search, the tier
that offers it costs roughly 85x what the plain Core tier costs, and the Core tier
itself (the only one anywhere near a hobby-project budget) has no privacy-preserving
option at all — it's plaintext-email-or-nothing at that price point.

### The API-key problem specific to a browser extension

Even setting the cost aside, there's a structural problem the HIBP docs don't need to
address but Moat would: any authenticated HIBP endpoint requires an `hibp-api-key`
header on every request. A WebExtension's code — background script, content script, or
otherwise — ships to every installer as plain, easily-unpacked JavaScript; there is no
way to embed a secret API key in a client-side browser extension without publishing it
to everyone who installs the extension. A leaked key gets used by others against the
maintainer's own paid quota (or, per HIBP's acceptable-use terms, risks the key being
throttled or revoked for policy violations the maintainer didn't commit —
[HIBP API v3](https://haveibeenpwned.com/API/v3) prohibits "querying the data for
purposes that are intended to cause harm to the victims of data breaches" and
circumventing rate limits, neither of which Moat would control once the key is public).
The only structurally sound way to use an authenticated HIBP endpoint from a
client-side extension is to run a server that holds the key and proxies requests —
which is exactly the "no server infrastructure" constraint Moat's brief already rules
out, the same shape of problem the VPN doc's option (b) ran into.

### Verdict

**Pwned Passwords (k-anonymity password/breach checking): buildable, small-to-medium
lift, no server needed.** It uses only `fetch()` from a background script or content
script — APIs already inside Moat's capability envelope — needs no API key, no account,
and no rate-limit budget to worry about. A natural integration point is a login/signup
form: hash the field's current value locally (SHA-1, doable in-browser via
`crypto.subtle.digest`), query the range endpoint, and warn (not block) if the full
hash appears in the returned suffix list — passive, informational, no decision made for
the user, matching Moat's existing "decide nothing by default" posture.

**Email-based breach checking (`breachedAccount`, even its k-anonymity variant): not
buildable inside Moat's current shape.** It requires either a paid API key Moat cannot
safely ship client-side, or a server Moat doesn't have and the brief says it doesn't
want. This is a hard infrastructure/cost gate, not a WebExtension-capability gate — the
API itself is real and reachable via `fetch()`, but "reachable" and "safely usable by
an unauthenticated client shipping the secret to the world" are different things.

---

## 2. Tracker/company visibility and control

uBlock Origin's per-site dynamic-filtering "firewall matrix" is already covered (and
declined, on philosophy grounds) in the ad-blocker roadmap doc's §6 item 6 — out of
scope here; this section covers only Privacy Badger's and Ghostery's *presentation*
layer, not editable per-domain firewalls.

### Privacy Badger's per-site slider dashboard

Privacy Badger's own FAQ documents a three-state, per-domain slider shown in the
extension's popup for the site currently open: **red** — "content from this third
party domain has been completely disallowed"; **yellow** — the domain "appears to be
trying to track you, but it is on Privacy Badger's cookie-blocking 'yellowlist'... Privacy
Badger will load content from the domain but will try to screen out third party cookies
and referrers from it"; and **green** — "'no action'; Privacy Badger will leave the
domain alone." Users can also click a whole-site "Disable for this site" control from
the same popup. ([Privacy Badger FAQ](https://privacybadger.org/))
This is presented per-domain, per-tab, live — it's a dashboard, not a settings page.

### Ghostery's per-tracker detail popup

Ghostery's own FAQ describes a similar but more editorial pattern: "From within the
Ghostery control panel, you can click any tracker listed to reveal a short description
of who provides it," with a "Continue to full tracker profile" link into WhoTracks.me,
"world's largest database of trackers owned and operated by Ghostery." The panel also
exposes an "Observed activities" view where a user "can make changes to individual
trackers," defaulting to "block all." ([Ghostery FAQ](https://www.ghostery.com/faq))

### Relevance to Moat's existing code

**Correction (2026-08-26): this is already shipped, not a gap.** Moat ships both halves of
this today: `src/background/matchStats.ts` correlates each matched rule's domain against
Ghostery's TrackerDB at build time to attach a company name to a block, *and* the popup
already renders a per-tab, read-only "By company" list from that data —
`renderCompanyBreakdown()` in `src/popup/popup.ts`, wired to a collapsed-by-default
`<details id="company-details">` in `src/popup/popup.html`. This section originally framed
the presentation layer as missing; it wasn't checked against the actual popup code before
writing that, and it was wrong. The one piece Ghostery's own popup has that Moat's still
doesn't is the richer per-tracker drilldown (click a company for a description + a link
into WhoTracks.me) — a real, much smaller gap than "no list at all."

### Verdict

**Already shipped — no further action.** Moat already has the per-rule company data, the
per-tab correlation, and the popup UI listing companies seen on the current page. Nothing
left to build here beyond the narrower click-through-for-a-description gap noted above,
which is its own, much smaller candidate if ever prioritized.

<details>
<summary>Original verdict (superseded by the correction above)</summary>

A read-only, per-site "who was blocked on this page" list: buildable, small lift.
Moat already has the underlying per-rule company data and per-tab match logging (the
diagnostic rule-match logger); this is substantially a UI/wiring exercise, not a new
detection or matching engine, and stays purely informational — no per-domain override
control implied.

**An editable per-domain allow/cooldown control (Privacy Badger's slider, or Ghostery's
"make changes to individual trackers"): real philosophy tension**, the same tension the
ad-blocker doc already named for Brave Shields' per-site panel and uBO's firewall
matrix (§6 items 5–6 there) — delegating a block/allow decision to the user per domain
runs against "decide nothing for the user by default." Worth flagging rather than
building reflexively; a read-only version captures most of the value without the
tension.

</details>

---

## 3. Site isolation / container-style privacy

### Firefox Multi-Account Containers

Mozilla's own MDN reference for the `contextualIdentities` API this extension is built
on describes the mechanism precisely: "each contextual identity has a name, a color,
and an icon. New tabs can be assigned to an identity... Internally, each identity gets
a cookie store that is not shared with other tabs. This cookie store is identified by
the `cookieStoreId`." ([MDN: contextualIdentities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities))
This is real, per-container cookie-jar isolation — not a UI grouping — implemented at
the cookie-store level, which is why logging into the same site in two different
containers can maintain two genuinely separate sessions. Multi-Account Containers
itself is a first-party Mozilla extension distributed through the same
addons.mozilla.org channel any third-party extension uses.
([mozilla/multi-account-containers](https://github.com/mozilla/multi-account-containers))

### Chrome has no equivalent — checked directly, not assumed

MDN's own compatibility framing states the constraint bluntly: **"Contextual identities
are not supported in any other browsers"** — and this research verified the Chrome
side independently rather than trusting that line alone, by fetching Chrome's complete
extension API index directly: it lists `chrome.identity` (OAuth2 token retrieval, an
unrelated feature despite the similar name) and `chrome.cookies` (query/modify cookies,
with no per-container/per-identity cookie-store concept anywhere in its description),
and no `contextualIdentities`, `cookieStoreId`, or `containers`-named API at all.
([MDN: contextualIdentities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities); [Chrome extension API index](https://developer.chrome.com/docs/extensions/reference/api))
This confirms, rather than assumes, that container-style cookie-store isolation is
**Firefox-exclusive** at the WebExtension-API level — there is no Chrome code path that
gets Moat even partway there, unlike (say) CNAME uncloaking, which at least has a
DoH-based Chrome workaround Moat could build itself (per the ad-blocker doc's §2).
Here there is no workaround at all: cookie-store partitioning below `chrome.cookies`'s
visibility simply doesn't exist as an extension-controllable concept on Chrome.

### Verdict

**Not buildable as a cross-browser Moat feature, and not obviously worth building even
Firefox-only.** The technical gap is real and confirmed directly (not inferred), so
this isn't a "go build it, just Firefox-scoped" situation the way CNAME uncloaking is —
Mozilla's own first-party extension already implements this well, is actively
maintained, ships through the same store Moat does, and a user who wants containers can
just install it alongside Moat with zero coordination needed between the two (they
solve genuinely different problems — Moat blocks trackers, Containers partitions
identity — and neither extension needs to know about the other to both work). Rebuilding
it inside Moat would mean maintaining a second, permanently-Firefox-only feature with
no Chrome story at all, duplicating a solved problem rather than filling a gap.

---

## 4. Tracking-parameter stripping from URLs

### ClearURLs' rule format and mechanism

ClearURLs is a real, shipped, open-source WebExtension: "ClearURLs is an add-on based
on the new WebExtensions technology and is optimized for Firefox and Chrome based
browsers" and "will automatically remove tracking elements from URLs" using "a large
catalog of rules." ([ClearURLs Rules README](https://github.com/ClearURLs/Rules/blob/master/README.md); [ClearURLs docs](https://docs.clearurls.xyz/1.27.3/))
Its own rule-format spec documents the structure precisely: rules are organized into
**providers** — one JSON entry per site/service — each with a required `urlPattern`
regex identifying which URLs the provider applies to; an optional `rules` array of
query-parameter names to strip; an optional `rawRules` array of regexes that "can refer
to the entire URL and not just individual fields," for cases a simple param-name list
can't express; an optional `referralMarketing` array of fields preserved unless the
user opts to strip affiliate/referral params too (disabled by default); `exceptions`
(URLs to skip entirely); and `redirections` (extract a real destination URL out of a
tracking-redirect wrapper URL, via the first regex capture group, then
`decodeURIComponent()` it and navigate there instead).
([ClearURLs rule specs](https://docs.clearurls.xyz/1.27.3/specs/rules/))
Rule data itself ships from a separate repo, `ClearURLs/Rules`, distributed as a
minified JSON file plus a checksum for integrity verification, fetched by the installed
extension rather than baked in at build time the way Moat's own filter lists are.
([ClearURLs Rules README](https://github.com/ClearURLs/Rules/blob/master/README.md))

### Overlap with what Moat already ships

This research confirmed directly in-repo that Moat already bundles an AdGuard "URL
Tracking" filter-list group: `src/shared/matchedRuleCategories.ts` maps the
`"url-tracking"` group into Moat's "trackers" breakdown bucket, and
`src/options/filterPresets.ts` enables `"url-tracking"` by **default** in Moat's
"standard" preset — not even an opt-in tier. AdGuard's own URL-tracking list, compiled
into Moat's DNR rulesets the same way its other 10 bundled lists are, is solving
substantially the same problem ClearURLs solves (strip identifying query parameters via
declarative URL-rewrite rules) using the mechanism Moat already has (DNR, build-time
compiled, no runtime fetch), rather than ClearURLs' shape (webRequest-driven,
runtime-fetched rule JSON, separate trust/update channel).

### Verdict

**Likely substantially redundant with a feature Moat already ships, on by default.**
This isn't a "go build it" candidate so much as a "go check what, if anything, AdGuard's
URL-tracking list actually misses that ClearURLs' broader/independently-maintained rule
catalog catches" — an audit, not a new engine. If real coverage gaps turn up (some
providers only in ClearURLs' catalog, or ClearURLs' `redirections`/`rawRules` handling
covering cases AdGuard's simpler rule shape doesn't), the fix is more likely "add
specific missing rules to Moat's own dynamic-rule layer" than "build a second parallel
URL-rewriting engine" — Moat's existing DNR-redirect mechanism can already express
query-param stripping and destination-URL redirection, the two things ClearURLs' format
is actually for.

---

## 5. Third-party resource localization

### Decentraleyes' mechanism

Decentraleyes is a real, shipped, open-source WebExtension. Its own description states
the mechanism directly: it "intercepts traffic, finds supported resources locally, and
injects them into the environment" — i.e. when a page requests a well-known
CDN-hosted library (jQuery and similar libraries served from Google Hosted Libraries,
cdnjs, and comparable CDNs are the commonly-cited targets), the extension serves an
equivalent copy it ships inside its own package instead of letting the request reach
the CDN at all. ([decentraleyes.org](https://decentraleyes.org/); [Synzvato/decentraleyes README](https://github.com/Synzvato/decentraleyes/blob/master/README.md))
Its own site is candid that this is a mitigation, not a guarantee: "Decentraleyes is no
silver bullet, but it does prevent a lot of websites from making you send these kinds
of requests" — and it offers an explicit fallback for the resources it doesn't bundle:
a user "can make Decentraleyes block requests for any missing CDN resources" outright
rather than let them through unprotected. ([decentraleyes.org](https://decentraleyes.org/))
The underlying privacy rationale (not directly quoted in what this research could fetch
from Decentraleyes' own current docs, but implicit in "intercepts traffic... injects
them into the environment" and consistent with the project's own framing above) is that
a shared CDN sees every visitor to every site that references it, which is itself a
cross-site tracking vector even before considering supply-chain tampering risk — serving
a local copy means the CDN never sees that request at all.

### Verdict

**Buildable, medium lift, and architecturally close to something Moat has already
scoped.** The mechanism (bundle known resource files, redirect matching requests to a
`web_accessible_resources`-exposed local copy) is the same DNR-redirect-to-local-resource
pattern already identified as a small, closeable gap in the ad-blocker roadmap doc
(§ "Candidates for Moat" item 1, re: AdGuard's `$redirect` no-op resources) — this would
be the same mechanism applied to a different resource catalog (real library files
instead of no-op stubs). The actual work is compiling and maintaining a version-pinned
library catalog (which jQuery/React/etc. versions to bundle, and keeping them updated as
CDN-hosted versions drift) rather than novel extension architecture — closer to a
data-maintenance burden than an engineering one, but a real, ongoing one.

---

## 6. Reading/distraction-free mode

### The technology is real and well-documented

`mozilla/readability` is Mozilla's own open-source library: "A standalone version of
the readability library used for Firefox Reader View." It works by DOM analysis and a
scoring heuristic — evaluating candidate elements by content density, link density, and
a minimum character threshold (500 characters by default) to identify which part of a
page is the actual article, then returning extracted title/content/author/date via a
`parse()` method, with an `isProbablyReaderable()` pre-check to cheaply decide whether
a page is worth trying to parse at all. ([mozilla/readability](https://github.com/mozilla/readability))
Chrome ships a comparable native feature too — "reading mode," confirmed directly via
Chrome's own help docs as a **native, built-in** feature (not an extension): it opens
"an immersive, full screen reading view of the page," strips distractions, and is
explicitly documented as incompatible with "image galleries, interactive maps, forms,
quizzes, payment pages, and login screens" — a deliberate content-type exclusion list.
([Chrome Help: Use reading mode](https://support.google.com/chrome/answer/14218344))

### Verdict — lean skeptical, as instructed

**Both major browsers already ship this natively, well, for free.** Firefox has had
Reader View since 2015 (per `mozilla/readability`'s own framing as "the library used
for Firefox Reader View"), and Chrome's own reading mode is a first-party feature, not
a third-party gap Moat would be filling. Building this inside Moat would mean shipping
and maintaining a DOM-heuristic content-extraction engine — real, nontrivial ongoing
work (site markup changes break these heuristics regularly, the same fragility class
Moat's own YouTube-dimmer and feed-scanner heuristics already exhibit per the ad-blocker
doc) — to duplicate a feature both target browsers already give users for free, with no
privacy or security angle distinguishing Moat's version from the built-in one. This is
a scope mismatch, not a technical-feasibility question: reading mode has nothing to do
with tracking, ads, popups, fingerprinting, or cookie consent, and adding it would
stretch Moat's identity toward "browser productivity extension" territory it doesn't
currently occupy for no privacy benefit over what's already built in.

---

## 7. HTTPS-upgrade enforcement

### Now a browser-level feature on both target browsers, not an extension-level one

Firefox's own security blog announced this directly: "Firefox attempts to establish
fully secure connections to every website, and Firefox asks for your permission before
connecting to a website that doesn't support secure connections" — HTTPS-Only Mode,
shipped in Firefox 83 (November 2020) as a native browser preference, not an extension.
([Mozilla Security Blog: Firefox 83 introduces HTTPS-Only Mode](https://blog.mozilla.org/security/2020/11/17/firefox-83-introduces-https-only-mode/))
Chrome is converging on the same default behavior: Google's own security blog documents
a phased rollout — Chrome 147 (April 2026) enables "Always Use Secure Connections" by
default for users who've opted into Enhanced Safe Browsing ("over 1 billion users"),
and Chrome 154 (October 2026) enables it by default for everyone, with Chrome's own
experiment data cited directly: "the median user sees fewer than one warning per week,
and the ninety-fifth percentile user sees fewer than three warnings per week."
([Google Security Blog: HTTPS by default](https://blog.google/security/https-by-defau/))
Both mechanisms operate at the browser's own navigation/network layer, upgrading or
warning *before* a page load completes — structurally the same "browser-level, not
extension-level" pattern the VPN doc already established for DNS-over-HTTPS (§4 of that
doc): no WebExtension API on either browser exposes a way to configure or replicate this
setting from extension code, and none would need to, since both browsers are actively
shipping it as an on-by-default feature during 2026.

### Verdict

**Nothing for Moat to build here, and building it would be strictly worse than
declining to.** An extension-level HTTPS-upgrade attempt would necessarily run *after*
the browser has already started a navigation decision (extensions observe/intercept
requests, they don't sit ahead of the browser's own scheme resolution the way a native
preference does), making any extension-side version a strictly weaker, redundant
shadow of a feature both browsers are actively finishing the rollout of as native,
on-by-default behavior in 2026. This is a clean decline: real feature, real primary
sources, wrong layer for an extension to re-implement.

---

## Candidates for Moat

Concrete, scoped suggestions only — each tagged with backing source(s) and a rough
implementation-cost estimate.

1. **Add an opt-in leaked-password check on password fields, backed directly by HIBP's
   free Pwned Passwords k-anonymity range API.** Hash the field value locally
   (SHA-1 via `crypto.subtle.digest`, already available in a content-script/background
   context), query `api.pwnedpasswords.com/range/{first 5 hex chars}` with no API key
   and no rate limit, and warn — never block or auto-fill anything — if the full hash
   matches a returned suffix. This is the one genuinely new client-side capability this
   survey found that is both real (a live, documented, zero-auth public API) and fits
   Moat's existing "no server, no account, warn don't decide" shape exactly.
   Source: [HIBP: Pwned Passwords](https://haveibeenpwned.com/Passwords), [HIBP API v3](https://haveibeenpwned.com/API/v3).
   **Cost: medium** (client-side hashing plumbing plus a warning UI is straightforward;
   deciding *which* forms to hook, and how conservatively to detect "this is a password
   field," is the real design work).

~~2. Add a read-only, per-tab "who was blocked here" tracker/company list to the popup~~
   — **already shipped, struck out 2026-08-26.** See the correction in §2 above:
   `matchStats.ts` + `popup.ts`'s `renderCompanyBreakdown()` already do exactly this.

3. **Bundle common CDN-hosted JS libraries locally and redirect matching requests to
   them, Decentraleyes-style, reusing the DNR-redirect mechanism already scoped for
   AdGuard's `$redirect` resources in the ad-blocker roadmap doc.** Same request-
   interception shape Moat already has (DNR static redirect rules pointed at
   `web_accessible_resources`), applied to a curated library catalog instead of no-op
   stub files. The ongoing burden is catalog maintenance (which library versions to
   ship and keep current), not new architecture.
   Source: [decentraleyes.org](https://decentraleyes.org/), [Synzvato/decentraleyes](https://github.com/Synzvato/decentraleyes).
   **Cost: medium** (build-time infra is small; the version-tracking maintenance tail is
   the real ongoing cost).

4. **Audit Moat's existing bundled AdGuard "URL Tracking" filter-list group against
   ClearURLs' independently-maintained rule catalog for coverage gaps, rather than
   building a second URL-cleaning engine.** Moat's `url-tracking` group is already
   enabled by default in the "standard" preset (confirmed in-repo,
   `src/options/filterPresets.ts`) and folds into the existing trackers bucket
   (`src/shared/matchedRuleCategories.ts`) — this is very likely a "check for gaps,
   patch specific missing rules into Moat's own dynamic layer if found" task, not a
   from-scratch build.
   Source: [ClearURLs rule specs](https://docs.clearurls.xyz/1.27.3/specs/rules/), [ClearURLs/Rules](https://github.com/ClearURLs/Rules/blob/master/README.md).
   **Cost: small** (a data-comparison exercise; cost grows only if real gaps are found
   and need new dynamic rules).

5. **Decline: don't build a Firefox-style container/site-isolation feature.** Verified
   directly (not assumed) that Chrome's extension API surface has no equivalent of
   Firefox's `contextualIdentities`/`cookieStoreId` — this would be permanently
   Firefox-only, and Mozilla's own first-party Multi-Account Containers extension
   already solves the problem well, is actively maintained, and installs alongside Moat
   with zero coordination needed. Building a second, Chrome-incompatible identity-
   isolation feature duplicates a solved problem rather than closing a gap.
   Source: [MDN: contextualIdentities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities), [Chrome extension API index](https://developer.chrome.com/docs/extensions/reference/api).
   **Cost: n/a (decision only).**

6. **Decline: don't build HTTPS-upgrade enforcement.** Both Chrome and Firefox already
   ship this as a native, on-by-default (or rapidly becoming on-by-default) browser
   feature operating at the network/navigation layer, a layer no WebExtension API can
   act ahead of. Any extension-side version would be a strictly weaker, redundant
   shadow of what the browser itself is already finishing rolling out through 2026.
   Source: [Mozilla Security Blog: Firefox 83 HTTPS-Only Mode](https://blog.mozilla.org/security/2020/11/17/firefox-83-introduces-https-only-mode/), [Google Security Blog: HTTPS by default](https://blog.google/security/https-by-defau/).
   **Cost: n/a (decision only).**

7. **Decline: don't build a reading/distraction-free mode.** Real, well-documented
   technology (`mozilla/readability`'s DOM-scoring heuristic is genuinely reusable),
   but both target browsers already ship equivalent native reading modes for free, and
   the feature has no privacy/security nexus at all — pure scope creep away from
   Moat's identity as a privacy/ad-blocking tool, with the same site-markup-fragility
   maintenance burden already flagged as a weakness in Moat's existing YouTube-dimmer
   and feed-scanner heuristics, for a feature that adds nothing over what's already
   built into the browser.
   Source: [mozilla/readability](https://github.com/mozilla/readability), [Chrome Help: reading mode](https://support.google.com/chrome/answer/14218344).
   **Cost: n/a (decision only).**

8. **Explicitly out of scope for this candidate list (not evaluated, not declined):
   HIBP email-based breach checking (`breachedAccount`).** Flagged separately from the
   declines above because the blocker here is not philosophy or redundancy — it's a
   real infrastructure gate. The endpoint requires a paid, secret API key that cannot
   be safely embedded in client-side extension code, and the one variant of this
   endpoint that does offer HIBP's k-anonymity privacy model is gated behind a Pro-tier
   subscription (~$379/month) far outside a non-commercial one-maintainer project's
   budget. Revisit only if Moat ever stands up server infrastructure for an unrelated
   reason — nothing here is buildable client-side today.
   Source: [HIBP API v3](https://haveibeenpwned.com/API/v3), [HIBP: Find the Right Plan](https://haveibeenpwned.com/Subscription).

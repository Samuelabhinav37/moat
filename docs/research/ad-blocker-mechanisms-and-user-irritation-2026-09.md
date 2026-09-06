# Ad-Blocker Mechanisms and User Irritation: How the Tech Works, What Actually Bothers People (2026-09)

This doc has two jobs: (1) explain six core ad/tracker-blocking mechanisms from primary technical
sources — specs, official docs, academic papers, maintainer engineering posts, not marketing copy —
and check each against Moat's actual code; (2) go beyond the existing GitHub-issue-tracker pass in
[`data-usage-optimization-ui-user-demand-2026-09.md`](data-usage-optimization-ui-user-demand-2026-09.md)
§5 (which covered 6 competitors' own repo issue trackers and already shipped a fix in v0.11.47) to
find what genuinely irritates ad-blocker users more broadly — Reddit, Hacker News, tech press,
academic UX/measurement research — and trace each irritation to its actual root cause.

**Not re-covered here**, since it's already settled ground: the MV3 architecture comparison across
uBlock Origin/AdGuard/Brave/Ghostery/Privacy Badger in
[`ad-blocker-architecture-and-roadmap.md`](ad-blocker-architecture-and-roadmap.md) §1 (rarest-token
bucketing, the hostname trie, DOM-surveyor gating, class/id cosmetic sharding); the nine "Candidates
for Moat" from that doc, all reconciled against current code in the data-usage doc §2; Moat's own
measured resource footprint and competitors' self-reported numbers (data-usage doc §1); the UI
side-by-side (data-usage doc §4); or the feature-parity gap tables in
[`competitive-gap-audit.md`](competitive-gap-audit.md) and
[`competitive-gap-audit-2026-09.md`](competitive-gap-audit-2026-09.md). Where this doc's findings
touch those (Acceptable Ads, CNAME uncloaking, Consent-O-Matic), it cross-references rather than
repeats.

**Method note on Part 2 honesty**: several searches for specific Reddit threads (r/uBlockOrigin,
r/browsers) returned only tech-press secondary coverage or uBO's own GitHub wiki, not live,
fetchable Reddit threads — this session's WebFetch tool cannot retrieve `reddit.com` at all (every
attempt returned a hard tool-level refusal, not a content gap). Where that happened, it's stated
plainly below rather than papered over with a paraphrased "Reddit users say..." that traces to
nothing. Hacker News, by contrast, was fully reachable via its official Algolia search API and
individual thread fetches, and is used directly with real point/comment counts throughout.

---

## Part 1 — How six core mechanisms actually work, reconciled against Moat

### 1. Static declarative filter rules (`declarativeNetRequest` under MV3)

**How matching works.** An extension no longer sees the request stream at all — it declares rules
up front (a set of `condition`/`action` pairs) and the browser itself evaluates them against every
request. For the "before request" phase, Chrome finds *at most one* matching rule per extension by
ordering all matching rules by `priority` first, then by action type where priorities tie:
`allow`/`allowAllRequests` > `block` > `upgradeScheme` > `redirect`. When more than one installed
extension wants to act on the same request, a second, separate prioritization runs across
extensions, with `block` beating `redirect`/`upgradeScheme` beating `allow`, and the most recently
installed extension winning remaining ties. Chrome's own docs flag a real footgun here: two rules
with the *same* action and the *same* priority run in an order that is explicitly undefined and can
change between browser versions — you cannot rely on rule *declaration order* for anything, only on
distinct `priority` values.
([Chrome for Developers: declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest))

**The rule-count budget.** Static rules: up to 100 rulesets can be *declared*, but only 50 can be
*enabled* at once, with a guaranteed minimum of 30,000 total static rules across all of an
extension's own enabled rulesets — beyond that guaranteed floor, rules draw from a **global pool
shared across every extension installed in the browser** (AdGuard's own blog states the shared
figure directly: "30,000 rules per extension and a total limit of 330,000 rules for all extensions
installed by a single user," so a user running two rule-heavy blockers has both competing for one
pool — [AdGuard MV3 blog](https://adguard.com/en/blog/adguard-mv3.html)). Dynamic rules (created at
runtime, not bundled at build time) cap at 30,000 total, with a stricter 5,000-rule sub-limit for
"unsafe" dynamic rules (broad-reach ones like a bare redirect); session rules cap at 5,000 and are
cleared on every browser restart or extension update; regex rules are capped at 1,000 per ruleset
type and each compiled regex must stay under 2KB.
([Chrome for Developers: declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest))
**No vendor among the five researched in the companion architecture doc documents a smart, ranked
eviction algorithm for what happens when a static ruleset blows past its cap** — Firefox silently
truncates
([MDN: declarativeNetRequest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest)),
and AdGuard's own production answer sidesteps the question rather than solving it (a small
*dynamic*-rule "Quick Fixes" pool for hot-patching, orthogonal to the static-budget eviction problem
itself) — already established in the data-usage doc §3, not re-derived here.

**Why blocking `webRequest` was removed, specifically.** Chrome's own migration docs state the
rationale directly: the old `webRequest` blocking model let any of an unlimited number of listeners,
across any number of installed extensions, synchronously intercept and mutate *every single network
request* a page made — Chrome's docs say plainly that this "could significantly degrade both the
performance of extensions and the performance of pages they work with." The deeper architectural
point (confirmed independently by the Ghostery and Privacy Badger primary sources already cited in
the companion architecture doc's §1) is that `webRequest`-blocking gave an extension's own JS code a
synchronous read on your full browsing traffic before deciding what to do with it; `declarativeNetRequest`
never shows that content to the extension at all — the browser applies the declared rules internally
— which is a categorical privacy/security improvement *and* a categorical capability loss for
anything that needs to inspect or rewrite a request's actual content (not just allow/block/redirect
it), which is exactly the capability Ghostery's identifier-stripping and Privacy Badger's heuristic
learning both relied on.
([Chrome for Developers: Replace blocking web request listeners](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests))

**Moat's fit**: matches documented best practice directly — `background/customRules.ts` and
`background/liveRedirectRules.ts`/`background/quickFixRules.ts` use explicit `priority` values (allow
rules at `priority: 2` above block rules at `priority: 1`) rather than relying on declaration order,
exactly the pattern Chrome's own caveat above warns is otherwise unsafe; `background/filterGroups.ts`
tracks and reports the shared-pool budget explicitly to the user (Settings → Filter Lists shows which
lists didn't fit) rather than failing silently, which the data-usage doc §3 already found puts Moat
ahead of most of the field on budget transparency.

---

### 2. Cosmetic/element-hiding filtering

**How it works.** A cosmetic rule is not a network rule at all — it never stops a request, it hides
an element already present in the DOM by injecting CSS. The shared syntax across EasyList, AdGuard,
and uBlock Origin distinguishes two kinds by what precedes the `##` separator: `example.com##.selector`
is **domain-specific** (applies only on that domain and its subdomains), while a bare `##.selector`
is **generic** (applies everywhere the styling loads). uBO's own filter-syntax reference states the
distinction plainly: "Generic cosmetic filters are hiding filters that apply to all pages," in
contrast to a hostname-scoped rule. A page can opt itself out of generic hiding entirely with
`$generichide` on an exception rule targeting its own domain — a real escape hatch sites use when a
too-broad generic selector collides with their own legitimate markup.
([uBO static filter syntax](https://github.com/gorhill/ublock/wiki/static-filter-syntax);
[AdGuard KB: create your own ad filters](https://adguard.com/kb/general/ad-filtering/create-own-filters/))
Beyond plain CSS selectors, both AdGuard (`ExtendedCss`, supporting `:contains()`, `:matches-css()`,
a polyfilled `:has()`) and uBO (procedural filters: `:has-text()`, `:matches-css()`, `:xpath()`,
`:upward()`, action operators like `:remove()`/`:style()`) support a materially more expressive
selector language for the harder cases a plain `<style>` block can't express — text-content matching,
computed-style matching, DOM-tree-relative targeting — already covered in depth in the architecture
doc's §1, not re-derived here.

**The inherent limitation.** Cosmetic hiding is fundamentally reactive and content-agnostic: it
removes an element's *visibility*, not the ad request that filled it, so a `display:none`'d ad slot
still fires its network request (unless a separate network rule also blocks it) and, if the
underlying element used fixed dimensions or was part of a grid/flex layout, hiding it can leave a
blank gap or reflow surrounding content unpredictably — this exact failure mode (leftover whitespace,
broken layout) is documented independently in Part 2 below, sourced from a real, dated Hacker News
report of uBO's Annoyances filter list breaking a page's actual CSS.

**Moat's fit**: matches the documented generic/domain-specific split, plus adds its own performance
layer on top not found in the spec itself — `src/content/cosmeticSelectors.ts` fetches only the 1-3
domain-hash-bucketed shard files (of 64) a given hostname needs rather than one flat file, per
`docs/design-notes.md`'s "Cosmetic filtering internals" section — but Moat does **not** implement
either AdGuard's ExtendedCss or uBO's procedural-filter engine (`scripts/lib/parseCosmeticRules.mjs`
explicitly skips scriptlet and extended-selector syntax that "need a JS engine, not a `<style>` tag"
per the design notes), so any upstream rule relying on `:has-text()`/`:matches-css()`/`:contains()`
is silently dropped at build time rather than degraded gracefully — a real, documented, deliberate
scope boundary, not an oversight, but a strictly narrower cosmetic-rule surface than either AdGuard
or uBO ship.

---

### 3. CNAME/DNS uncloaking

**Why trackers cloak behind a CNAME.** A tracker sets up `trk.example.com` as a CNAME alias pointing
to their own infrastructure (`example.com.trackerco.net`), so a browser's own same-origin/first-party
cookie and storage rules — and any domain-based ad-blocker rule — see only the first-party-looking
`trk.example.com` hostname, never the actual third-party operator behind it. This is a deliberate,
purpose-built evasion of exactly the domain-matching logic both browsers' privacy protections and
static filter lists rely on.

**The two detection paths.** (1) **Firefox's native `dns.resolve()`**: a WebExtension API that lets
an extension ask the browser to resolve a hostname and inspect the result, including any CNAME chain
— Chrome has no equivalent API surface at all, confirmed directly in MDN's own reference page, which
Chrome's extension docs simply don't mirror.
([MDN: dns.resolve()](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/dns/resolve))
A documented caveat even on Firefox: this silently stops working when DNS-over-HTTPS is enabled in
the browser, because the `dns.resolve()` code path doesn't route through the browser's own DoH
resolver the way ordinary navigation does
([uBlockOrigin/uBlock-issues #1190](https://github.com/uBlockOrigin/uBlock-issues/issues/1190)).
(2) **A DoH-based lookup an extension performs itself**: a background service worker can `fetch()` a
public DoH endpoint (e.g. Cloudflare's `1.1.1.1/dns-query`) for a hostname and read the CNAME chain
directly out of the JSON response — technically available on Chrome (no special permission needed
beyond host access to the DoH endpoint), but no primary source from any of the five competitors
researched documents shipping this; it introduces its own tradeoffs no vendor has published a
resolution for: which third-party resolver to trust/hardcode, added per-navigation latency, and
routing every hostname a user visits through that third party as a side effect of a *privacy*
feature. NextDNS solves the same problem at the DNS-resolver layer instead, where it has native
visibility into every intermediate CNAME hop, and separately publishes an open list of known
cloak-*destination* domains usable without any DNS resolution at all.
([nextdns/cname-cloaking-blocklist](https://github.com/nextdns/cname-cloaking-blocklist);
[NextDNS: CNAME cloaking write-up](https://medium.com/nextdns/cname-cloaking-the-dangerous-disguise-of-third-party-trackers-195205dc522a))

**Moat's fit**: matches path (1) exactly and is honest about the gap — `src/background/cnameUncloak.ts`
implements Firefox's `dns.resolve()` path only, gated to Firefox, off by default, and the README's
"Known limitations" states outright "Chrome has no DNS-resolution API for extensions." Moat has also
already adopted NextDNS's cloak-destination list (`rules/dnr/cname-cloak-destinations.json`, shipped
v0.9.0 per the data-usage doc §2). Path (2) — a self-issued DoH lookup to extend uncloaking to Chrome
— remains a genuinely open, undecided design question in Moat's own roadmap doc, correctly left
undecided rather than defaulted either way, matching every competitor's own silence on Chrome-side
uncloaking.

---

### 4. Consent-management-platform (CMP) auto-rejection

**How Consent-O-Matic models the problem declaratively.** Rather than scraping each site's markup
ad hoc, Consent-O-Matic (CAVI, Aarhus University) represents a cookie banner's UI as inert JSON data
interpreted by code the extension itself ships: **detectors** (CSS-selector checks for whether a
given CMP is present), **methods** (named, ordered action sequences like `DO_CONSENT`/`SAVE_CONSENT`),
and **actions** drawn from a small, fixed, closed vocabulary (`Click`, `Hide`, `WaitForCSS`, `Slide`,
etc.), each targeting elements purely by CSS selector. The peer-reviewed paper behind it (Nouwens,
Bagge, Kristensen, Klokmose, CHI '22) frames this explicitly as "adversarial interoperability" —
using the CMP's own exposed DOM structure against it — and grounds the *need* for the tool in a
separate finding from that same research group: roughly 90% of real-world consent banners studied
use dark patterns designed to make "reject" meaningfully harder to reach than "accept."
([ACM: Consent-O-Matic — Automatically Answering Consent Pop-ups Using Adversarial Interoperability](https://dl.acm.org/doi/fullHtml/10.1145/3491101.3519683);
[cavi-au/Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic))
The critical trust-boundary distinction from a scriptlet-based approach (AdGuard's MV3-era model,
already covered in the architecture doc's §1): a Consent-O-Matic rule can never contain arbitrary
executable code — only a reference into a fixed, pre-audited action enum the extension's own
interpreter executes. There is no rule-author-supplied code path to review at all, which is a
stronger guarantee than "we pre-verified and bundled every scriptlet body," AdGuard's own compromise
under Chrome Web Store scrutiny.

**Moat's fit**: matches the model precisely and by deliberate design — `src/content/consent/` is,
per `docs/design-notes.md`, "a from-scratch interpreter for Consent-O-Matic's declarative rule
format... inert JSON describing which selector to click, never code to run, the same trust boundary
as Moat's own cosmetic selectors," ported by hand from the MIT-licensed upstream source rather than
guessed from its schema (two real schema/implementation mismatches were caught doing that, per the
design notes). Every category defaults to reject, matching Consent-O-Matic's own out-of-the-box
default. Deliberately narrower than upstream: no drag-simulated sliders, and coverage limited to
`rules/dnr/consent-rules.json`'s few dozen most-reused platforms rather than Consent-O-Matic's 200+
bespoke per-site catalog — a documented, bounded scope decision, not silent partial coverage.

---

### 5. Fingerprint resistance / noising

**The vectors and the defense.** Canvas fingerprinting reads back pixel data from an invisible
`<canvas>` render (`toDataURL()`/`getImageData()`), which varies subtly by GPU, driver, font
rendering, and OS text-antialiasing — enough entropy to distinguish most individual browsers. Audio
fingerprinting does the analogous thing with `AudioContext`/`OfflineAudioContext` signal processing,
which likewise varies by hardware/OS audio-stack quirks. Both were characterized rigorously in
Laperdrix et al.'s "Beauty and the Beast: Diverting Modern Web Browsers to Build Unique Browser
Fingerprints" (IEEE S&P 2016) and the same authors' later "Browser Fingerprinting: A Survey" (ACM
TWEB 2020), which frames the general defense as **introducing noise into the API's actual output**
— not swapping in one fixed fake value (a distinct, easily-fingerprintable signal itself), but
perturbing the real computation slightly and consistently, so repeated reads on the same session
still agree with each other (defeating simple "does it change" liveness checks) while differing
between installs (defeating cross-site correlation).
([Beauty and the Beast, IEEE S&P 2016](https://www.semanticscholar.org/paper/Beauty-and-the-Beast:-Diverting-Modern-Web-Browsers-Laperdrix-Rudametkin/fe2f4faec5cf209ae7d8a73100db9cce46ce53d4);
[Browser Fingerprinting: A Survey](https://www-sop.inria.fr/members/Nataliia.Bielova/papers/Lape-etal-20-TWEB.pdf))

**The inherent breakage risk.** Because canvas and audio APIs are *also* used for entirely legitimate
purposes (canvas-based CAPTCHAs, WebGL-adjacent rendering checks, audio-processing web apps), noising
their output is not a free action — a site's own liveness/CAPTCHA check can start failing if the
noise is large enough to change what the site reads as a meaningfully different result each time
(this exact tradeoff is why every noising implementation researched, Moat's included, keeps this
feature opt-in rather than default-on). Brave's public fingerprinting-defenses writeups already
covered in the architecture doc's §4 describe the same tradeoff for their farbling system and for
font-enumeration specifically, including the genuinely unsolved architectural gap: font-enumeration
detection (measuring rendered text width via `offsetWidth`/`getBoundingClientRect`) has no dedicated,
interceptable API the way canvas/audio reads do, so it can't be noised at the extension layer without
touching generic layout properties every page legitimately depends on — already fully researched and
closed as a Moat non-candidate per the data-usage doc §2 item 5, not re-derived here.

**Moat's fit**: matches the documented deterministic-noise-not-fixed-fake-value model exactly —
`src/content/fingerprintNoise.ts` applies per-install deterministic noise to `toDataURL`/`toBlob`/
`getImageData` and `AudioBuffer.getChannelData`, with a nested opt-in to rotate the noise seed
per-browser-session instead (stored in `browser.storage.session`, in-memory only) for users who want
Brave's "different device each restart" model instead of Moat's stickier per-install default — both
documented in `docs/design-notes.md`, both off by default for the exact CAPTCHA-breakage reason the
academic literature predicts.

---

### 6. Anti-adblock detection and circumvention

**How sites detect an active blocker.** The most rigorous primary source found here is Nithyanand
et al., "Adblocking and Counter-Blocking: A Slice of the Arms Race" (USENIX FOCI '16) — a
measurement study across the Alexa Top-5K, not an opinion piece. It found **at least 6.7% of the
Top-5K ran some form of anti-adblocking**, sourced from just 14 distinct downloaded scripts (12
domains) — the technique is heavily consolidated, not bespoke per site. The mechanism, per the
paper's direct source-code inspection, is uniformly a **bait-object check**: either (1) inject a
fake ad container (a `<div>` with an ad-like class/id) and compare its rendered `height`/`width`/
`display` against expected "properly loaded" values, or (2) load a bait script whose sole job is to
set a variable, then have the real detection script check whether that variable actually got set —
if the bait element or bait script never rendered/ran, the page concludes a blocker is active.
Detected users are then tracked persistently (a cookie/localStorage flag) so the check doesn't have
to re-run every page load. Anti-adblocking is concentrated in specific publisher categories — News
(19.5% of the anti-adblocking sites the paper found), Blogs/Wiki (9.3%), Entertainment (8.5%) — and
overwhelmingly comes from a small number of ad-industry-adjacent suppliers (PageFair chief among
them, plus Google ad-service domains, Taboola, Outbrain).
([usenix.org/foci16-paper-nithyanand](https://www.usenix.org/system/files/conference/foci16/foci16-paper-nithyanand.pdf))
The same paper found the arms race runs both directions: testing three popular blockers (AdBlock
Plus, Ghostery, Privacy Badger) against the 12 anti-adblock script suppliers, **half were already
counter-blocked by at least one of the three** — Ghostery and Privacy Badger each caught 4 of 12,
AdBlock Plus only 1 of 12 — by the simple expedient of blocking the anti-adblock script's own request
the same way any other tracker request gets blocked. This paper is from 2016; no more recent
academic replication at the same rigor (Alexa-Top-5K-scale, source-code-verified) was found in this
pass, which is itself worth flagging rather than assuming the 6.7% figure holds unchanged a decade
later — sites' actual detection scripts have almost certainly evolved, even if the underlying
bait-object premise likely hasn't needed to change much, since it doesn't depend on any specific
blocker's implementation.

**The countermeasure, in practice, is filter-list content, not a distinct architecture.** Consistent
with the companion architecture doc's own finding (§6 item 7, "evidence-limited"), no first-party
engineering writeup from AdGuard, uBO, or a community anti-circumvention list maintainer was found
describing anything beyond "more filter rules that block the bait script's own request or neutralize
the bait element it queries" — i.e. counter-blocking an anti-adblock script is handled the same way
as blocking an ad: it's a network/cosmetic rule like any other, not a special-purpose engine.

**Moat's fit**: no dedicated anti-adblock-detection module exists in `src/` (confirmed by a direct
grep across the source tree — the only hits for "anti-adblock"-adjacent terms are
`background/liveUpdates.ts` and `background/quickFixRules.ts`), which matches the industry pattern
above exactly rather than diverging from it: Moat's 11 bundled AdGuard lists (which include AdGuard's
own annoyances/anti-circumvention content by inheritance, not verified line-by-line here) plus the
daily `live/quick-fixes.json` channel are the mechanism, not a bespoke detector-defeater. Notably,
`docs/design-notes.md` states this channel was purpose-built partly for exactly this case — "an
AdGuard 'Quick Fixes filter'-style channel for patching an anti-adblock-circumvention script... without
waiting on a full store review cycle" — so Moat has a *shipped, working* rapid-response path for this
category even though nothing has needed to flow through it for this specific purpose yet, as far as
this pass could confirm from the changelog.

---

## Part 2 — What genuinely irritates ad-blocker users, and why

### 2.1 Site-side anti-adblock walls that block access entirely

**What it is.** A publisher detects blocking (Part 1 §6's bait-object check) and refuses to render
content at all until the blocker is disabled or the visitor whitelists the site — sometimes gated
behind a further subscribe/donate ask.

**Root cause.** Purely a publisher business-model decision, not a technical necessity — the site
chooses to withhold content specifically to coerce a setting change, using the detection mechanism
described in Part 1 §6.

**How common/well-evidenced.** The most concrete, dated, well-documented case is Forbes's own
December 2015–January 2016 experiment forcing readers to disable ad blockers before granting access,
which backfired in a way that is itself instructive: within days, users who complied were served
malware via the Angler Exploit Kit through Forbes's own ad network, independently reported by
multiple outlets and traced to a named security researcher's real-time discovery.
([Network World: How Forbes inadvertently proved the anti-malware value of ad blockers](https://www.networkworld.com/article/946902/forbes-malware-ad-blocker-advertisements.html);
[Techdirt](https://www.techdirt.com/2016/01/11/forbes-site-after-begging-you-turn-off-adblocker-serves-up-steaming-pile-malware-ads/);
[Engadget](https://www.engadget.com/2016-01-08-you-say-advertising-i-say-block-that-malware.html))
Wired ran a similar wall in the same period, with reporting describing extended access denial driving
some users to simply stop visiting the site rather than comply
(via secondary tech-press coverage synthesized from multiple period sources; Forbes's own first-party
retrospective article exists — "Inside Forbes: Our Ad Block Test Stirs Up Emotions" — but returned an
HTTP 403 to this pass's fetch attempt and is not claimed as independently verified here). This is a
2015-16-era flashpoint, not a live 2026 measurement — the underlying mechanism (Part 1 §6) is
unchanged and still active industry-wide (YouTube's 2023-2026 escalation, §2.6 below, is the current,
live instance of the same pattern), but no fresher large-scale prevalence count for hard walls
specifically (as opposed to nag banners) was found in this pass.

**Extension-addressable?** Only partially, and asymmetrically. An extension can counter-block the
*detection script itself* (Part 1 §6's "half the anti-adblock suppliers were already counter-blocked"
finding) faster than it can guarantee content actually renders once detection fails — a site's
server can always add a second, independent check. Whether the page then serves malware (Forbes's
case) is entirely the publisher's own ad-network hygiene, structurally outside any client-side
blocker's control **in one direction** (a blocker can't force a site's ad network to be clean) but
squarely **inside** blocking's actual value proposition in the other (a blocker that successfully
defeats the detection script never lets the malicious ad load in the first place, which is the
Forbes case's actual moral for the pro-blocking side).

---

### 2.2 The "Acceptable Ads" whitelisting-for-pay model and user distrust

**What it is.** Adblock Plus/eyeo's Acceptable Ads program whitelists ads meeting stated
non-intrusiveness criteria by default; large publishers/networks can pay eyeo a fee (reported by the
Financial Times and corroborated by multiple period outlets at "30% of the additional ad revenue"
recovered) to have their ads included in that whitelist.
([The Register: Google, Amazon 'n' pals fork out for AdBlock Plus 'unblock'](https://www.theregister.com/2015/02/02/google_amazon_taboola_microsoft_adplock_plus_unblock))

**Root cause.** A direct, structural conflict of interest: the company whose stated purpose is
blocking ads is paid by advertisers to *not* block some of them, with no independent enforcement of
the "acceptable" criteria that a payer's own ads don't also happen to meet regardless.

**How common/well-evidenced.** This is one of the best-evidenced items in this whole pass, on two
independent axes:
- **Business-model confirmation, from eyeo's own numbers.** eyeo's own 2026 ad-blocking report states
  96% of its userbase has Acceptable Ads enabled (up from 94% in 2023) — already cited in
  `competitive-gap-audit-2026-09.md` §2, reused here as direct evidence the opt-out is deliberately
  unattractive/hard to find, not that users actively chose it.
  ([eyeo 2026 ad-blocking report](https://eyeo.com/wp-content/uploads/2026/05/eyeo_2026-ad-blocking-report.pdf))
- **Independent measurement of actual harm.** A 2025 NYU Tandon study (Roongta, Jose, Habib, advised
  by Greenstadt; presented at PETS 2025, over 1,200 ads analyzed across the US and Germany) found
  Acceptable-Ads users saw **13.6% more problematic ads** than users with no ad blocker at all —
  17.6% more for US users specifically, and users under 18 saw a **21.8%** increase, with 10.7% of
  ads shown to minors under Acceptable Ads violating age-appropriateness norms (alcohol/gambling/
  dating-service ads) versus 9.6% for unblocked users. The mechanism the researchers identify: ad
  exchanges *already inside* the Acceptable Ads program, once approved, actually increase delivery
  of problematic content to exactly the users who trusted the "protected" label, while newer
  entrants to the program (under fresher scrutiny) show fewer violations — i.e. the program's own
  incentive structure decays over time for incumbents.
  ([NYU Tandon: Ad blockers may be showing users more problematic ads, study finds](https://engineering.nyu.edu/news/ad-blockers-may-be-showing-users-more-problematic-ads-study-finds);
  paper: [racro.github.io/papers/Accads_PETS.pdf](https://racro.github.io/papers/Accads_PETS.pdf))
- **User/developer-community backlash, dated and specific.** The original 2011 rollout of the program
  itself drove real Hacker News engagement — "AdBlock Plus will soon allow 'non-intrusive' ads by
  default" drew 241 points and 165 comments — and the pattern recurred structurally, not just once:
  a separate, later Hacker News thread, "AdBlock owner sells company and buyer turns on acceptable
  ads" (the unrelated `getadblock.com`/"AdBlock" extension changing hands and immediately re-enabling
  Acceptable Ads), shows this isn't a one-time controversy but a repeatable failure mode tied
  structurally to ownership/monetization changes in *any* free ad-blocking product.
  ([HN: AdBlock Plus will soon allow "non-intrusive" ads by default](https://news.ycombinator.com/item?id=3342214);
  [HN: AdBlock owner sells company and buyer turns on acceptable ads](https://news.ycombinator.com/item?id=10314434))
  A structurally identical, more recent instance: the popular "I don't care about cookies" extension's
  2022 acquisition by Avast — a company with its own documented history of extensions collecting and
  selling browsing data, leading to prior Chrome Web Store removals — triggered immediate community
  concern and forking specifically because of Avast's ownership, independent of any actual observed
  misbehavior by the acquired extension itself.
  ([The Register: 'I Don't Care About Cookies' web extension sold to Avast](https://www.theregister.com/security/2022/09/21/i-dont-care-about-cookies-web-extension-sold-to-avast/1302221);
  [HN discussion](https://news.ycombinator.com/item?id=32850799))

**Extension-addressable?** Fully addressable, and it's a business-model choice, not a technical
constraint — uBlock Origin has demonstrated for over a decade that a filter-based blocker can simply
not have a paid-whitelist mechanism at all. This is squarely a **positioning** question for any
blocker, Moat included, not an engineering gap.

---

### 2.3 Cosmetic filtering breaking page layouts

**What it is.** Hiding an element via CSS (`display:none` or similar) removes it from the visible
page but can leave behind layout artifacts — an empty gap where a fixed-height ad slot used to sit,
a broken CSS grid/flex arrangement if the hidden element was a structural grid item, or (per the one
concretely sourced case found in this pass) an entire page's *own* legitimate stylesheet getting
misidentified as ad-adjacent content and blocked outright.

**Root cause.** A structural side effect of hiding-not-removing: cosmetic filtering can't know
whether an element it's told to hide is purely decorative ad content or load-bearing for the
surrounding layout, and a generic (not domain-specific) rule is, by definition, being applied
blind across sites its author never tested against.

**How common/well-evidenced.** Genuinely thin evidence for the *specific* whitespace/grid-breakage
framing — this pass could not surface a large, well-quantified thread or study on this exact failure
mode, and that should be stated plainly rather than inflated. The one concrete, dated, real example
found: a Hacker News commenter on an unrelated "Show HN: One Page Calendar 2020" post (517 points,
98 comments overall — the ad-blocker remark is one reply within it, not the thread's topic) reported
that uBlock Origin, with the optional AdGuard Annoyances list enabled, "totally breaks the page
layout" because the site's own legitimate CSS/stylesheet resource was being matched and blocked by
that cosmetic/annoyances filter list — a genuine false-positive breakage case, but a single anecdote,
not a measured prevalence rate.
([HN: Show HN: One Page Calendar 2020](https://news.ycombinator.com/item?id=21921165)) uBO's
own wiki independently documents the *general* failure surface without a prevalence number: generic
cosmetic filters can visibly flash content before hiding it ("may take effect after the page
displays"), a related but distinct annoyance from permanent layout breakage.
([uBO: Cosmetic filtering version 0.4.0.0 update](https://github.com/uBlockOrigin/uBlock-issues/wiki/Cosmetic-filtering-in-uBlock:-version-0.4.0.0-update))
This is genuinely a case where the data doesn't support a strong quantitative claim — it should be
read as "a real, structurally-explainable failure mode" rather than "a widely-complained-about top
irritation," which the evidence gathered here does not support.

**Extension-addressable?** Yes, in the sense that better selector engineering (targeting a
self-contained ad *container* rather than a bare class, avoiding hiding structural/grid-parent
elements, per-domain testing rather than blind generic rules) reduces the failure rate, but it can
never reach zero for a rule set covering millions of pages the filter-list maintainers never
individually tested.

---

### 2.4 False sense of "I'm fully protected" vs. actual coverage gaps

**What it is.** A user running any ad/tracker blocker reasonably assumes near-complete protection;
actual coverage against trackers, fingerprinting scripts, and (per §2.7 below) even ads themselves
varies substantially by tool and configuration, and the gap is often invisible to the user by
construction — there is no error message when a tracker successfully loads.

**Root cause.** Structural, not a specific tool's failure: filter lists are necessarily reactive
(a domain must be identified and added before it's blocked), first-party-disguised trackers (CNAME
cloaking, Part 1 §3) evade domain-based rules by design, and newer fingerprinting-based tracking
doesn't require a blockable network request pattern at all in the same way classic third-party
cookies did.

**How common/well-evidenced.** Reasonably well-evidenced at the "coverage varies, defaults matter"
level, thinner at the "users are specifically overconfident" level (a genuine gap, flagged rather
than papered over):
- A peer-reviewed measurement study, "Investigating the effectiveness of web adblockers" (full text
  fetch failed against a PDF-parsing limitation in this pass's tooling, so this citation is included
  at the abstract/secondary-summary confidence level, not independently verified line-by-line),
  reportedly found ad-blocker effectiveness at reducing third-party requests averaging around 40%
  with default settings, with real spread across tools — some (Blur, Disconnect) showing materially
  weaker anti-tracking than others (uBlock Origin) at default settings, and some tools' meaningful
  protection requiring manual configuration most users never touch.
  ([arxiv.org/pdf/1912.06176](https://arxiv.org/pdf/1912.06176) — flagged confidence caveat above)
- The already-cited PoPETs 2026 MV3-effectiveness paper (Papadopoulos & Lukic, cross-referenced from
  the data-usage doc §1) is directly relevant here and worth restating with its actual finding, not
  just its citation: across four widely-used blockers' MV2 vs. MV3 builds, MV3 showed **no
  statistically significant reduction** in blocking effectiveness, and in some comparisons MV3
  blocked more trackers on average (1.8 more tracking scripts per site) than MV2 — a genuinely
  reassuring, myth-correcting finding against the intuitive fear that MV3 quietly broke protection.
  ([PoPETs 2026 abstract page](https://petsymposium.org/popets/2026/popets-2026-0027.php);
  [The Register: Ad blocking alive and well, despite changes to Chrome](https://www.theregister.com/2026/02/06/chrome_mv3_no_harm_ad_blocking/))
- A separate, concrete 2026 trust-erosion data point, not about ad blockers specifically but squarely
  relevant to "false sense of protection" from *any* browser extension: a February 2026 independent
  security researcher's investigation found **over 300 Chrome extensions, with a combined 37 million
  installs, actively leaking or selling users' browsing history** to more than 30 named data-broker
  and analytics companies — independently reported by The Register, SecurityWeek, and CSO Online, not
  a single-source claim.
  ([The Register: Security researcher finds 287 Chrome extensions leaking data](https://www.theregister.com/security/2026/02/11/security-researcher-finds-287-chrome-extensions-leaking-data/4482477);
  [CSO Online](https://www.csoonline.com/article/4132712/leaky-chrome-extensions-with-37m-installs-caught-shipping-your-browsing-history.html))
  This isn't evidence that ad blockers specifically are the culprit — it's evidence that "I installed
  a privacy-shaped extension, therefore I'm protected" is, at the ecosystem level, frequently false,
  which is the exact belief this irritation category is about.
- What this pass could **not** find: a rigorous, direct study measuring whether ad-blocker *users
  specifically* hold miscalibrated confidence about their own coverage (a genuine attitudinal/survey
  question, distinct from the effectiveness-measurement studies above) — flagged explicitly as an
  evidence gap rather than assumed true by inference from the effectiveness numbers alone.

**Extension-addressable?** Partially. Effectiveness gaps from stale filter lists or CNAME cloaking
are addressable (better lists, uncloaking where the platform allows it, Part 1 §3). The
*overconfidence* half of this irritation — a user's internal belief about their own coverage — is not
something a blocker's blocking logic can fix at all; it's addressable only through honest, calibrated
UI communication (not overselling "fully protected" language), which is a design/copy decision, not
an engineering one.

---

### 2.5 Notification/permission fatigue from blocker popups or prompts

**What it is.** Two related but distinct sources of fatigue: (a) an ad blocker's *own* nag UI
(upsell prompts, "please whitelist us" asks, update banners), and (b) the broader ecosystem of
site-side modal interruptions — cookie-consent banners chief among them — that blockers are often
specifically installed to suppress, with mixed success.

**Root cause.** For (a): a free extension's own monetization or engagement pressure creates an
incentive to interrupt the user inside the one surface they opened to get *away* from interruptions.
For (b): the GDPR's consent requirement, intended to give users real control, in practice normalized
a universal modal-interruption pattern across the entire web, independent of any single site's
intent — a regulatory-response second-order effect, not an ad-blocker problem at all, but one users
frequently expect a blocker to solve for them.

**How common/well-evidenced.** The strongest single piece of evidence found in this entire pass for
this category is a live, large Hacker News discussion (395 points at time of fetch) explicitly about
web-wide modal/popup fatigue — commenters describe abandoning tasks and purchases specifically
because of newsletter/survey/donation/cookie modals, debate whether GDPR cookie-consent requirements
inadvertently legitimized the broader pattern by normalizing "manufactured consent" screens, and
**explicitly name uBlock Origin and Consent-O-Matic by name as the working mitigation** — directly
validating Consent-O-Matic's real-world value (Part 1 §4) from the demand side, not just the supply
side.
([HN: Web Browsers have stopped blocking pop-ups](https://news.ycombinator.com/item?id=46446366))
This pass could not locate a comparably rigorous, well-evidenced Reddit or press source specifically
quantifying fatigue from an ad blocker's *own* nag UI (category (a)) — the search surfaced general
awareness that some free blockers run donation/whitelist asks, but nothing at the evidentiary bar
this doc is holding itself to for the rest of this section, so that half is flagged as
under-evidenced rather than asserted as a major pattern.

**Extension-addressable?** Category (a) fully — it's the blocker's own choice not to nag, which
uBlock Origin, Ghostery, and Moat all already demonstrate is a viable product stance. Category (b)
only partially — a blocker can suppress/auto-answer the *symptom* (Consent-O-Matic-style auto-reject,
Part 1 §4) but can't change the regulatory dynamic that made modal-based consent UI the industry
default in the first place; that's a legal/regulatory-environment cause, structurally outside any
extension's reach.

---

### 2.6 YouTube's specific, ongoing ad-blocker-detection arms race

**What it is.** YouTube runs active, escalating server-side detection of ad-blocking extensions on
its own site — distinct from the generic third-party anti-adblock-script industry in Part 1 §6
because Google controls both the content and the detection, with no third-party supplier in between.

**Root cause.** A direct first-party business decision by the platform with the largest single
concentration of blockable video-ad revenue at stake, executed at the server/page-script level in a
way no client-side extension logic can preemptively neutralize without playing pure reaction.

**How common/well-evidenced.** Extensively documented across multiple independent axes, spanning
2023 through 2026:
- **Escalation timeline, from tech press covering YouTube's own statements.** YouTube began testing
  outright playback blocking for detected ad-blocker users in mid-2023
  ([The Verge: YouTube tests disabling videos for people using ad blockers](https://www.theverge.com/2023/6/29/23778879/youtube-videos-disabling-ad-blockers-detection)),
  and by late 2023/early 2024 was independently reported to be introducing deliberate, non-Chrome-browser
  playback delays that YouTube's own statement conflated with ad-blocker detection: "Users who have
  ad blockers installed may experience suboptimal viewing, regardless of the browser they are using"
  — YouTube's own quoted words, not a third party's characterization.
  ([TechRadar: YouTube may now have annoying delays if you use an ad-blocker](https://www.techradar.com/computing/browsers/youtube-may-now-have-annoying-delays-if-you-use-an-ad-blocker-heres-why))
- **Legal/regulatory response, filed and ruled on, not just threatened.** Privacy advocate Alexander
  Hanff filed a formal complaint with Ireland's Data Protection Commission in October 2023 arguing
  YouTube's client-side detection script violates ePrivacy Directive Article 5(3) — which requires
  consent before storing or accessing information on a user's device — since running a detection
  script is not "strictly necessary" for the service YouTube nominally provides.
  ([The Register: Privacy advocate challenges YouTube's ad blocking detection](https://www.theregister.com/2023/10/26/privacy_advocate_challenges_youtubes_ad-blocking-detection/932131);
  legal-industry analysis: [natlawreview.com](https://natlawreview.com/article/youtubes-adblocker-avoidance-tech-may-violate-gdpr))
  Separately, Austria's data protection authority issued a real, dated 2025 enforcement decision
  against Google LLC/YouTube (unrelated GDPR data-access complaint via noyb, not the ad-blocker
  detection complaint specifically, but confirming EU regulators are actively willing to rule against
  YouTube's practices in this space) ordering compliance within four weeks.
  ([malaymail.com: Austria's data authority orders YouTube to comply with EU GDPR](https://www.malaymail.com/news/tech-gadgets/2025/08/30/austrias-data-authority-orders-youtube-to-comply-with-eu-gdpr-user-data-access-rules/189355))
- **Ongoing, current friction found in this pass's own competitor-issue-tracker research (already
  logged in the data-usage doc §5, restated here for Part 2 completeness rather than duplicated
  analysis)**: an AdGuard GitHub issue with 9👍/48 comments as recently as this pass documents
  YouTube's detection still breaking playback despite AdGuard actively running — evidence the arms
  race has not settled in the blocker's favor even for a well-resourced competitor.

**Extension-addressable?** Structurally the hardest item in this whole document to fully solve, and
worth being honest about why: YouTube controls both the player code *and* the ad-serving decision
server-side, so a client-side blocker is always reacting to whatever detection heuristic YouTube
shipped most recently, with no way to get ahead of a change it can't see before it ships. What *is*
addressable is exactly what Moat already does for the sub-problem it chose to solve — Moat's own
`youtubeAdDimmer.ts` doesn't try to detect-and-defeat YouTube's ad-blocker-*detection*, it dims the
in-stream ad *content itself* (a materially different, narrower problem: the ad still plays, Moat
never claims otherwise) via two independent DOM signals specifically so one YouTube markup change
can't silently break the whole feature, per `docs/design-notes.md`. Whether YouTube's actual
blocker-detection-and-playback-block escalation (the subject of this section) could be countered the
way Part 1 §6 describes generic anti-adblock scripts being countered (blocking the detection script's
own request) is a materially bigger, first-party-controlled, actively-litigated target than the
third-party anti-adblock suppliers the FOCI16 paper studied — genuinely harder, not just differently
scoped.

---

### 2.7 Perceived vs. measured battery/performance/RAM cost of running a blocker

**What it is.** A persistent lay belief that any browser extension, blockers included, meaningfully
drains battery or slows the browser — set against measured reality that is, on the evidence gathered
here, generally the *opposite* direction for ad blockers specifically.

**Root cause of the perception**: extensions-in-general (especially malicious or poorly-written ones)
really can be heavy, so the belief isn't baseless as a category — it's specifically misapplied to
ad/tracker blockers, whose entire function is to *prevent* other, heavier work (ad/video/script
downloads, render/reflow from injected content) from happening in the first place.

**How common/well-evidenced.** The measured-reality side is well-evidenced and consistent across
independent sources, several already surfaced in the data-usage doc §1 and not re-derived here
(Ghostery's 2018 AC-current-sensor study claiming ~25% less energy use, Brave's 69x matching-speed
claim). New to this pass:
- Pearce (Michigan Tech), "Energy Conservation with Open Source Ad Blockers," peer-reviewed
  (*Technologies* 8(2):18, 2020) — already cited in the data-usage doc, restated here for Part 2's
  purpose: measured page-load-time reductions of 11% (AdBlock Plus), 22.2% (Privacy Badger), 28.5%
  (uBlock Origin), with derived energy/cost savings, not just speed.
  ([mdpi.com/2227-7080/8/2/18](https://www.mdpi.com/2227-7080/8/2/18))
- A separate, non-extension-specific but directly relevant root-cause finding: Microsoft/Purdue
  research (widely reported, e.g. via Fox News's synthesis of the underlying academic study) found
  that ad-related processes — uploading usage telemetry, GPS/location reads for targeting, and
  rendering the ad itself — accounted for **up to 75% of a typical free mobile app's total battery
  usage**, i.e. the ads are the actual battery cost, not any tool that blocks them.
  ([Fox News: Ads on Android Apps Significantly Drain Battery, Research Indicates](https://www.foxnews.com/tech/ads-on-android-apps-significantly-drain-battery-research-indicates.amp) —
  secondary coverage of the underlying study; the original academic paper's exact title/venue was not
  independently re-confirmed in this pass, flagged as a confidence caveat)
- A genuinely mixed academic data point, not one-sidedly pro-blocker: search results describing a
  comparative power-consumption study found some ad-blocking browser/extension combinations reduced
  power draw substantially (up to ~44% on video-heavy sites for some configurations) while at least
  one combination (Firefox with uBlock Origin, in that specific study's methodology) showed "quite
  relaxed" — i.e. less differentiated — results, and one browser+blocker pairing unexpectedly
  *increased* consumption under certain conditions. This is worth including precisely because it
  complicates a clean "blockers always save battery" narrative — the effect is real and usually
  favorable but not universal or configuration-independent.
  (Secondary synthesis of multiple 2020-era academic papers surfaced via search — specific paper
  titles/DOIs were not individually re-verified in this pass, flagged accordingly.)

**Extension-addressable?** The actual measured performance story is already favorable for blockers,
so this is less an engineering gap than a **communication** gap — the persistent lay belief exists
despite, not because of, the evidence. AdGuard has published directly on this exact topic
(`adguard.com/en/blog/ad-blocking-and-battery-usage.html`, surfaced in this pass but not
independently fetched/verified here); the data-usage doc §1 already established that most of the six
competitors researched publish *no* self-reported performance numbers at all, which if anything means
the persistent-myth problem is partly self-inflicted by the industry's own lack of published data,
not solely user misunderstanding.

---

### 2.8 Additional well-evidenced complaint found in the course of this research: acquisition-driven trust collapse in "free privacy tool" products

Not one of the brief's named categories, but surfaced repeatedly enough across §2.2's research to
warrant naming as its own pattern rather than folding silently into Acceptable Ads: **a free
ad-blocking or privacy tool changing ownership is, on its own, treated by users as sufficient reason
to distrust it — independent of any observed behavior change.** The "I don't care about cookies"/
Avast case and the "AdBlock" (getadblock.com)/Acceptable-Ads-reinstatement case (both §2.2) are two
independently-sourced instances of the same shape: an acquirer with either a documented data-selling
history (Avast) or a reason to want ad revenue (an ownership change plus payment from advertisers)
takes over a previously-trusted free tool, and the community's reaction is immediate and severe
regardless of whether the acquired product's actual code changed on day one. This is a **structural**
pattern about the free-privacy-tool market generally, not a single-incident story — worth naming for
Moat specifically because Moat's own no-account/no-server/zero-telemetry model (per README/PRIVACY.md)
is exactly the profile users in these threads describe *wanting* but not trusting will last, and
because the pattern implies that *any* future change of Moat's ownership, hosting, or monetization
model would itself become a trust event regardless of technical substance — worth remembering as a
standing constraint on any future business-model decision, not just a positioning talking point today.

---

## Closing synthesis

Sorting every Part 2 irritation against Moat's actual current code/docs/CHANGELOG (verified above
inline, not assumed):

| # | Irritation | Verdict | Basis |
|---|---|---|---|
| 2.1 | Anti-adblock walls / paywalls blocking access entirely | **(c)** structurally unfixable in the "guarantee content renders" direction; **(b)** partially addressable in the "defeat the detection script" direction, already the shape of Moat's filter lists + quick-fixes channel, no dedicated engineering gap identified | Part 1 §6; `docs/design-notes.md`'s quick-fixes description |
| 2.2 | Acceptable Ads pay-for-whitelist model and resulting distrust | **(a)** already handled — Moat has no paid-allowlist mechanism, no monetization, no account, by architecture, not policy statement alone | README "Monetization: Free, no premium tier, no telemetry"; `PRIVACY.md`; independently reconfirmed in `competitive-gap-audit.md` §2 and `competitive-gap-audit-2026-09.md` §4 |
| 2.3 | Cosmetic filtering breaking layouts | **(b)** partially addressable, evidence is thin enough that it's not a priority item — Moat's own domain-hash-sharded cosmetic delivery and jsdom-validated selector build step (`scripts/update-cosmetics.mjs`) are already a more conservative posture than "ship every generic selector everywhere," and the element picker's "gray out instead of hide" mode (per README) is a direct, already-shipped mitigation for exactly the case where hiding would break a layout | `docs/design-notes.md` "Cosmetic filtering internals"; README "Element picker" |
| 2.4 | False sense of full protection vs. real coverage gaps | **(b)** — the effectiveness side (stale lists, CNAME cloaking) is the same open item as Part 1 §3's Chrome-side DoH question, already flagged as a genuine open design decision, not newly discovered here; the overconfidence/communication side is addressable via UI copy, and Moat's existing "Light/Moderate/Heavy" framing (`src/shared/protectionLevel.ts`) is deliberately *not* a before/after grade specifically to avoid overclaiming, which the design notes state was a conscious choice, not an oversight | `docs/design-notes.md` block-count breakdown section; `ad-blocker-architecture-and-roadmap.md` item 3 |
| 2.5 | Notification/permission fatigue (blocker's own nag UI + cookie-banner modal fatigue) | **(a)** already handled on both counts — README states "No nag screens, no 'rate us' prompts, no onboarding tabs" (category (a)) and Moat's Consent-O-Matic-based auto-reject (category (b)'s addressable half) is shipped, off-by-default, and directly matches the exact remedy an HN thread with 395 points independently named | README intro; `src/content/consent/`; §2.5 above |
| 2.6 | YouTube's ad-blocker-detection arms race | **(b)** for the narrow slice Moat has chosen to fight (ad *content* visibility via the dimmer) — already shipped and hardened with two independent detection signals; **(c)** for the actual detection-and-playback-block war itself, which requires reacting to a first-party platform's own server-side changes with no way to get ahead of them | `docs/design-notes.md` "Grayed-out video ads"; §2.6 above |
| 2.7 | Perceived vs. measured battery/performance cost | **(c)** as a lay-belief problem no engineering change fixes by itself, but **(a)** on the "publish honest data instead of staying silent like most competitors" front — Moat already discloses one real (caveated) measurement, which the data-usage doc §1 found makes it more transparent on this specific point than 4 of 6 competitors researched, who publish nothing at all | `data-usage-optimization-ui-user-demand-2026-09.md` §1 |
| 2.8 | Acquisition-driven trust collapse in free privacy tools | **(c)** not a present-tense problem to fix, but a standing constraint worth naming: Moat's zero-server/zero-account model structurally limits *what* a future ownership change could even monetize (there's no user data or server infrastructure to sell access to), which is a stronger structural defense than a mere no-current-plans statement — but this is a forward-looking architectural property to preserve, not a bug to close today | README "Everything stays on your device — no accounts, no telemetry, no server, and nothing to sell"; §2.8 above |

**The single most actionable finding**: nothing in Part 2 surfaced a *new* concrete engineering gap
in Moat — every irritation with a plausible extension-side fix already has one shipped (Acceptable
Ads distrust, nag-UI fatigue, cookie-banner fatigue, the narrow YouTube ad-visibility fight, honest
performance disclosure), and the two irritations without a shipped fix (Chrome-side CNAME/DoH
uncloaking for 2.4, and countering YouTube's actual detection-and-block war for 2.6) are both
*already-identified, deliberately undecided* open items from prior research passes, not newly
discovered ones. The genuinely new information this pass adds is evidentiary, not prescriptive: the
NYU Tandon PETS-2025 numbers (13.6%/17.6%/21.8% more problematic ads under Acceptable Ads) give
Moat's existing "no paid allowlisting" stance a sharper, quantified, independently-measured backing
for messaging than the architecture doc's prior citation had, and the recurring
acquisition-driven-trust-collapse pattern (§2.8) is worth carrying forward explicitly the next time
any change to Moat's own hosting, distribution, or monetization model is considered — not because
one is planned, but because this pass's evidence says users judge that moment, not just present-day
behavior, when deciding whether to keep trusting a free privacy tool.

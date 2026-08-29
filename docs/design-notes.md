# Design notes

Deeper mechanics and rationale that used to live in the README. Nothing here is
required to build, run, or evaluate Moat — the [README](../README.md) covers that.
This is the "why it works the way it does" layer, kept so the same investigations
don't happen twice.

## Contents

- [Source layout and the testing pattern](#source-layout-and-the-testing-pattern)
- [Feature mechanics](#feature-mechanics)
  - [Grayed-out video ads](#grayed-out-video-ads)
  - [Aggressive feed ad removal](#aggressive-feed-ad-removal)
  - [Auto-reject cookie banners](#auto-reject-cookie-banners)
  - [Uncloak disguised trackers (Firefox)](#uncloak-disguised-trackers-firefox)
  - [Opt-in fingerprint resistance](#opt-in-fingerprint-resistance)
  - [Cosmetic filtering internals](#cosmetic-filtering-internals)
  - [Rule-match logger](#rule-match-logger)
- [Problems we hit and how we solved them](#problems-we-hit-and-how-we-solved-them)
- [Researched but not built yet — full reasoning](#researched-but-not-built-yet--full-reasoning)

## Source layout and the testing pattern

See `src/` for the layout: `background/` (service worker / event page), `content/`
(the content scripts — `mainWorldGuard.ts` for the page-context popup guard,
`bridge.ts` for the isolated-world relay to extension storage/messaging,
`cosmeticFilter.ts` for element hiding), `popup/` and `options/` (UI),
`shared/domainChain.ts` (the "is this hostname this domain or a subdomain of it"
check used by both the popup safety net and cosmetic filtering), `types.ts` (shared
message/settings shapes), and `scripts/manifest.ts` (builds `manifest.json` per
browser target).

The heuristics with the most test coverage each live in their own side-effect-free
module so they're importable without a browser environment:
`content/isPlausibleTrigger.ts` (the popup-firewall trigger check),
`background/redirectDomainMatch.ts` (the tab safety net's domain matcher), and
`content/cosmeticSelectors.ts` (which selectors apply to a given hostname) — all thin
wrappers imported by the files that actually register listeners or touch the DOM.
Same pattern for the newer additions: `shared/filterPresets.ts`,
`background/filterGroupState.ts`, `background/managedPolicyMerge.ts`, and
`shared/rulesetManifest.ts` are all pure and directly tested;
`background/filterGroups.ts`, `background/applyCustomRules.ts`, and
`background/managedPolicy.ts` are the thin browser-API wrappers around them.

## Feature mechanics

### Grayed-out video ads

YouTube's in-stream ads share the same `<video>` element as real content, so they
can't be network-blocked or cosmetically hidden without breaking the player.
`src/content/youtubeAdDimmer.ts` (YouTube-scoped, on by default) watches
`#movie_player` for two independent signals YouTube's own player already exposes —
the `ad-showing`/`ad-interrupting` class, and `.ytp-ad-module` having content — and
applies `filter: grayscale(1)` to the video while either is present. Verified live
against a real ad on a news livestream (2026-08-23). That's a first-party
observation of YouTube's own markup, not a third-party script — see the README's
"Known limitations" for why this is still best-effort despite the two-signal check.

YouTube's sidebar/in-feed "Sponsored" cards (`ytd-ad-slot-renderer` and friends) are
hidden outright instead, added as first-party selectors in
`scripts/update-cosmetics.mjs` since AdGuard's bundled ones weren't matching them
live. The element picker's "Gray out" mode uses the dimming mechanism too (a saved
selector list, `customGrayscaleRules` in Settings) for anything else hiding would
break.

### Aggressive feed ad removal

A fixed selector, static or picked, can't follow Instagram, LinkedIn, or YouTube's
infinite-scroll feeds, because all three randomize the class names on sponsored posts
specifically to defeat exactly that kind of rule (confirmed live for Instagram's
atomic CSS classes; LinkedIn has documented the same move to hashed CSS modules).
`src/content/feedAdScanner.ts` (opt-in, off by default) takes the same approach a
human would instead: a `MutationObserver` watches the feed for newly rendered posts,
and `src/content/feedAdLabel.ts` checks each one for a text node that's an exact,
case-insensitive match for "Sponsored," "Ad," "Promoted," or "Paid partnership" — per
*segment*, splitting on the separators feeds actually use between metadata (a post
header often renders as one text node reading "Sponsored · 2h", the same way an
organic post's is "username · 2h"), not a substring check, so a caption that mentions
one of those words in a sentence won't trip it. A match walks up to the nearest known
"whole post" ancestor (`article` on Instagram, `[role="listitem"]` on LinkedIn —
verified live against a real "Promoted" post, since the commonly-documented
`[data-urn]`/`.feed-shared-update-v2` selectors turned out to be stale —
`ytd-rich-item-renderer` and friends on YouTube) and hides it. Off by default because
a label match carries a little more false-positive risk than a fixed selector — for
people who want feeds fully cleaned rather than just what static rules catch.

### Auto-reject cookie banners

Cosmetic filtering already hides banners that match a plain selector, but AdGuard's
own Cookie Notices list mostly handles the "click reject for me" half via scriptlets:
arbitrary injected JS Moat deliberately never executes (see the README's
"Popup/redirect firewall" and licensing note for why that boundary matters).
`src/content/consent/` is a from-scratch interpreter for
[Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)'s declarative rule
format instead — inert JSON describing which selector to click, never code to run,
the same trust boundary as Moat's own cosmetic selectors. Every consent category
defaults to reject (`consent/types.ts`'s `REJECT_ALL`), Consent-O-Matic's own
out-of-the-box default too, not a stricter policy invented here.

Ported by hand from their MIT-licensed source (`Tools.js`, `Matcher.js`, `Action.js`,
`CMP.js`, `ConsentEngine.js`) rather than guessed from the schema alone — two real
schema-vs-implementation mismatches were caught doing that (a documented `styleFilter`
field the actual code never reads, and `DOMSelection`'s nominally-recursive
`{parent,target}` shape only ever being resolved one level deep in practice) and
matched to what the shipped extension actually does, not what its schema
aspirationally describes. Verified end-to-end in tests against the real,
currently-vendored Cookiebot and OneTrust rules — not just unit tests of the
interpreter in isolation — confirming the default-reject path clicks only
"Decline"/unchecks pre-checked categories, never "Accept" (see
`src/content/consent/engine.test.ts`).

Deliberately narrower than upstream in a few places, each explained in that
directory's file headers: no drag-simulated consent sliders, `close` is a safe no-op
rather than `window.close()` (this only ever runs in the page's own tab, not a popup
window), and no progress-dialog/PIP visual chrome, since Moat has nowhere it would
show. Opt-in, off by default — it's still clicking things on your behalf, closer in
kind to the aggressive feed scanner than to plain cosmetic hiding. Covers a few dozen
of the most widely-reused consent platforms (`rules/dnr/consent-rules.json`, vendored
by `scripts/vendor-consent-rules.mjs`), not Consent-O-Matic's separate 200+ per-site
bespoke rule catalog.

### Uncloak disguised trackers (Firefox)

A CNAME-cloaked tracker hides behind a subdomain of the site you're on (e.g.
`trk.example.com`) that secretly resolves elsewhere via DNS, specifically to defeat
domain-based blocking — the static rules never see the real destination, only the
disguised first-party-looking hostname. Chrome has no DNS-resolution API for
extensions at all, a hard platform gap; Firefox exposes `dns.resolve()`, the same API
uBlock Origin uses there for the same purpose.

`src/background/cnameUncloak.ts` adds a blocking `webRequest.onBeforeRequest` listener
(Firefox still allows this under MV3; Chrome no longer does) that, for a subresource
request whose hostname shares the current page's own domain (the actual cloaking
pattern — a true third-party domain is already visible to and blockable by the static
rules directly, so it's skipped, no DNS lookup needed), resolves the real canonical
name and cancels the request if it leads into a known tracker destination
(`rules/dnr/cname-cloak-destinations.json`, vendored from
[NextDNS's public list](https://github.com/nextdns/cname-cloaking-blocklist)).
Firefox's blocking listeners can return a `Promise` (supported since Firefox 52), so
this resolves DNS per-candidate-request directly rather than needing a separate
cache-warming pass. Off by default: it's a per-request DNS resolution with a
different cost/trust profile than everything else.

### Opt-in fingerprint resistance

A toggle, off by default: deterministic per-install noise on canvas
(`toDataURL`/`toBlob`/`getImageData`) and `AudioBuffer.getChannelData` reads, a
generic WebGL vendor/renderer string in place of your real GPU, and
`navigator.hardwareConcurrency`/`deviceMemory` rounded to common values.
"Deterministic" matters here: the same canvas content on the same install always
noises the same way, so a site re-reading it twice can't tell anything changed — but
different installs get different noise, which is what actually defeats cross-site
fingerprint correlation. Off by default because, unlike blocking, this is the one
feature that can occasionally change what a page observes (e.g. a canvas-based
CAPTCHA).

A second, nested opt-in — **rotate noise every browser session** — switches the seed
from the permanent per-install one to one stored in `browser.storage.session`
(in-memory, cleared on browser/extension restart), closer to Brave's model: a
fingerprint that never changes can itself become a durable cross-site identifier over
time, which rotating trades off against sites seeing a different "device" on every
restart. Off by default, layered under the parent toggle rather than replacing it,
since the deterministic default is the safer one for compatibility. Content scripts
can't reach `storage.session` until the background worker grants it access
(`storage.session.setAccessLevel`, called once at startup); on the rare page load
that races that call, this silently falls back to the permanent seed rather than
failing (`src/content/bridge.ts`).

### Cosmetic filtering internals

A build-time script (`scripts/update-cosmetics.mjs`) downloads the raw filter-list
text, parses standard `##selector`/`#@#`-exception cosmetic rules (skipping
AdGuard/uBO scriptlets and CSS-injection/extended-selector syntax that need a JS
engine, not a `<style>` tag — see the comment atop
`scripts/lib/parseCosmeticRules.mjs`), and validates every surviving selector against
jsdom so nothing invalid ships. Per-domain selectors are bucketed into 64 shard files
by a hash of the domain name (`bucketForDomain`, kept identical between
`scripts/lib/domainBucket.mjs` and `src/shared/domainBucket.ts`, cross-checked by a
test that runs both), so a content script only ever has to fetch the 1–3 buckets its
own hostname's domain chain hashes into — a real fix, not a micro-op: it cut the JSON
fetched on every single page load from ~5.8MB to well under 1MB (see "Problems we hit"
below).

A content script (`src/content/cosmeticFilter.ts`, top frame only) injects the
resulting selectors as `<style>` blocks at `document_start` — CSS rules, not a
one-time DOM pass, so they keep hiding elements a site adds later (SPA navigation,
lazy-loaded slots) without a MutationObserver. Per-domain and generic selectors go
into two separate blocks so a one-time cleanup pass, triggered on `window`'s `load`
event, can prune generic selectors that matched nothing anywhere in the final DOM
without touching the intentionally-scoped per-domain block. This is a style-engine
cleanup — fewer live selectors for the browser to keep evaluating on every later
recalc, which matters most on long-lived SPA tabs like Instagram, YouTube, and
LinkedIn — not a network optimization: the full generic set (~17k selectors) is still
fetched and injected upfront exactly as before. Not a MutationObserver either — it
runs once, after initial load, same "no persistent DOM watcher for cosmetic
filtering" design as the rest of this feature (see `selectorsStillMatching` in
`src/content/cosmeticSelectors.ts`).

### Rule-match logger

A development tool, not a user feature: `logger.html` (linked from Settings → About →
Debugging) lists every request `declarativeNetRequest.onRuleMatchedDebug` saw on the
active tab and which specific rule matched it, for diagnosing a filter or heuristic
that's stopped working without guessing. Chrome only fires that event for extensions
loaded unpacked (developer mode) — it stays empty on a Web Store install, and on
Firefox, which doesn't implement it at all — so `src/background/ruleLogger.ts`
feature-detects it and the page says so plainly rather than showing an empty table
with no explanation.

## Problems we hit and how we solved them

Most of these were found by actually driving the extension in a real browser against
a real site, not by reading the DOM structure off a blog post — the sites in question
(Instagram, LinkedIn, YouTube) all obfuscate or shift their markup in ways that make
static assumptions unreliable.

| Problem | Why it happened | How we solved it |
| --- | --- | --- |
| YouTube ad dimming looked broken | The setting defaulted to **off** — nobody had opted in, no code bug | Verified live against a real ad, confirmed detection worked once enabled, flipped the default to on, and added a second independent detection signal so one YouTube markup change can't silently disable it |
| YouTube's sidebar "Sponsored" cards stayed fully visible | AdGuard's bundled cosmetic selectors didn't match YouTube's current sidebar markup | Added first-party selectors (`ytd-ad-slot-renderer` and friends) directly in `scripts/update-cosmetics.mjs` rather than waiting on an upstream filter-list update |
| The feed scanner did nothing at all on LinkedIn | Its content script's `matches` list only covered Instagram and YouTube — LinkedIn was never in scope, this wasn't a selector bug | Added LinkedIn's URL pattern to `scripts/manifest.ts` |
| The feed scanner still missed LinkedIn posts once it *was* in scope | The commonly-documented `[data-urn]` / `.feed-shared-update-v2` container selectors turned out to be stale | Live DOM inspection found the real current wrapper is `[role="listitem"]`; added it as the primary selector and kept the old two as harmless fallbacks |
| Instagram's "Sponsored" label matched inconsistently | The label shares one text node with adjacent metadata — a post header renders as a single node reading `"Sponsored · 2h"`, the same way an organic post's is `"username · 2h"` | Split on the separators these feeds actually use (bullet, middle dot, vertical bar, or `" - "`) and matched each segment exactly, instead of loosening to a substring check that could start matching prose |
| Cosmetic filtering fetched ~5.8MB of JSON on every single page load | Per-domain selector files were sharded purely by file size (`chunkBySize`), unrelated to which site was actually open — every page fetched every domain's rules | Replaced size-based chunking with domain-hash bucketing (`bucketForDomain`), so a page now fetches only the 1–3 shard files its own hostname needs — verified live against a served build: ~700KB instead of ~5.8MB for a typical page |
| Live redirect-domain updates silently stopped refreshing after the rename | The GitHub repo was made private mid-project, breaking the unauthenticated `raw.githubusercontent.com` fetch `liveUpdates.ts` relies on | Flagged rather than fixed — repo visibility is a real decision (source availability, not just this feature), left for a deliberate call rather than changed unilaterally |
| The extension wouldn't load unpacked in Chrome at all (v0.11.31–0.11.37) | `src/managed_schema.json` used `"additionalProperties": false`; Chrome's managed-storage schema compiler requires it to be a schema object, not a boolean, and rejects the whole file otherwise. Firefox's `web-ext lint` doesn't check this, so CI stayed green | Removed all three occurrences; added `src/managedSchema.test.ts` to fail if a boolean `additionalProperties` is reintroduced |

## Researched but not built yet — full reasoning

From a pass on what a more complete privacy tool would also do. The README carries a
one-line version of each; this is the full rationale so a future pass doesn't
rediscover it from scratch.

### Instagram Stories ads

The aggressive feed scanner deliberately doesn't touch these, and that's a real
scoping decision, not an oversight. Investigated live: a Stories ad renders as a
full-screen slide inside the *same* viewer component that shows real stories — there's
no separate "ad container" the way there is in the main feed. Applying the feed
scanner's usual technique (hide the matched container) to a Stories ad would blank the
entire full-screen viewer, including the real stories around it, since they all share
one container. The correct fix is a different mechanism entirely — detect the ad slide
and auto-advance past it, the way you'd tap through it manually — which is closer to
"act on the page" than "hide an element," a bigger trust/scope step than anything else
this scanner does. Not built without an explicit decision to take that step.

### Font-enumeration fingerprinting

Not covered by the fingerprint-resistance toggle — canvas, audio, WebGL, and the two
navigator hints are. This one's a real architectural gap, not just an unimplemented
feature: Brave's approach (exposing only a randomized subset of user-installed fonts)
works because Brave patches font enumeration in the browser engine's own C++ layer,
something no extension can do. The actual detection vector fingerprinters use — render
invisible text in a candidate font, compare its measured width against a fallback via
`offsetWidth`/`getBoundingClientRect` — has no dedicated, interceptable JS API the way
canvas/audio reads do; those are generic layout properties every page's ordinary code
depends on, so noising them broadly risks real site breakage in a way nothing else
Moat's fingerprint guard touches does.

### uBlock Origin's per-site dynamic-filtering "firewall matrix"

A real, shipped, sourced technique — a full matrix UI letting an "advanced user" set
global vs. per-site allow/block rules down to individual third-party domains contacted
by the current page. Explicitly declined on philosophy grounds, not technical
infeasibility: this is real decision-delegation to the user at a granularity Moat's
"decide nothing for the user by default, quiet" stance directly argues against. uBO
itself gates it behind an explicit "I am an advanced user" opt-in for the same reason.

### Ghostery's `fetch`-monkeypatching approach to dynamic request modification

MV3's `declarativeNetRequest` can't do the data-driven request rewriting (stripping
identifying params, not just block/allow) Ghostery's tracker protection relies on, so
their stated approach is replacing built-in browser APIs like `fetch` from a content
script to claw some of that back — by their own admission, this "introduces
site-breakage risks and latency." A materially bigger trust/breakage step than
anything Moat already does (including the popup firewall's `window.open` wrapper,
which only intercepts a narrow, specific call, not a page's entire networking
surface).

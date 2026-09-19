# Tor Browser's anti-tracking techniques, and what a WebExtension can actually borrow

Researched 2026-09-19. This document answers a question from the project owner: *how
does Tor Browser protect users from tracking, fingerprinting, and popups, and are there
techniques from it Moat could realistically borrow without a Tor network or a patched
browser engine?* Sourced from the Tor Project's own design document and support/manual
pages, the Tor Project's GitLab issue tracker where fetchable, and Mozilla's own
documentation for the subset of these techniques ("Tor Uplift") that shipped into
mainline Firefox. Secondary "how Tor works" writeups were not used as sources for any
claim below; where a primary source could not be reached (GitLab's own issue pages
return HTTP 403 to automated fetches), that is stated explicitly rather than papered
over with a secondary summary.

It does not re-describe Moat's existing fingerprint-resistance code
(`src/content/fingerprintGuard.ts`, `src/background/privacySettings.ts`) in detail —
that already exists as opt-in canvas/AudioContext/WebGL noise, navigator-property
bucketing, a per-session rotation option, and Firefox-only pass-throughs to
`browser.privacy.websites.resistFingerprinting`/`firstPartyIsolate`. It exists to
identify the gap between that and what Tor Browser's actual, primary-sourced mechanisms
are.

---

## 1. Fingerprinting resistance: exact mechanisms

Tor Browser's design document states its guiding principle up front: for identifiers
that can't be eliminated, "striving for uniformity has generally proved to be a better
strategy for Tor Browser" than randomization — the goal is that all Tor Browser users
present the same fingerprint, reducing the number of distinguishable "buckets" per
metric rather than giving each user a unique-but-different one
([Tor Browser Design and Implementation, §4.6](https://2019.www.torproject.org/projects/torbrowser/design/)).
This is a materially different philosophy from Moat's own per-install deterministic
noise, which by design makes each install's fingerprint different from every other
install's (see the existing farbling-style approach flagged in
`ad-blocker-architecture-and-roadmap.md` item 5) — worth keeping in mind when reading
"could Moat borrow this" below, since borrowing a Tor mechanism verbatim can mean
importing an incompatible philosophy, not just a technique.

**Canvas.** Tor Browser patches Firefox so canvas `<canvas>` image-extraction calls
(`toDataURL`, `getImageData`, etc.) "prompt before returning valid image data"; if the
user hasn't authorized that specific canvas read, the API returns "pure white image
data" instead of the real pixels
([Tor Browser Design, §4.6.2, "HTML5 Canvas Image Extraction"](https://2019.www.torproject.org/projects/torbrowser/design/)).
This is a permission-gate-or-blank-output model, not a noise-injection model — the
opposite end of the design space from Moat's approach of returning plausible-but-wrong
noised pixels via an off-screen clone.

**WebGL.** WebGL is placed "behind click-to-play placeholders" requiring explicit user
authorization, and even once authorized, Tor sets `webgl.disable-extensions`,
`webgl.min_capability_mode`, and `webgl.disable-fail-if-major-performance-caveat` to
reduce what `getParameter()`, `getSupportedExtensions()`, and `getExtension()` can
reveal about the actual GPU/driver
([Tor Browser Design, §4.6.9, "WebGL"](https://2019.www.torproject.org/projects/torbrowser/design/)).
Again: gate-then-restrict, not spoof-with-plausible-values (Moat's
`SPOOFED_WEBGL_RENDERER`/`SPOOFED_WEBGL_VENDOR` approach is closer to what other
browsers, not Tor, do — see the Brave comparison already in
`ad-blocker-architecture-and-roadmap.md`).

**AudioContext.** The Tor Project's own issue tracker shows this one was genuinely
contested rather than solved cleanly. Issue #13017 ("Determine if AudioBuffers/
OfflineAudioContext are a fingerprinting vector") discusses that the AudioContext
fingerprint is a property of the underlying audio stack itself, is stable "across
different Tor Browser sessions and even after using New Identity," and considers a
canvas-style "prompt before allowing content to instantiate an AudioContext object" as
one proposed fix; a related report, issue #21984, specifically named
`audiofingerprint.openwpm.com` as a live test Tor Browser stable failed, with
`dom.webaudio.enabled = false` suggested as a blunt mitigation
(search-indexed content of
[gitlab.torproject.org/tpo/applications/tor-browser/-/issues/13017](https://gitlab.torproject.org/tpo/applications/tor-browser/-/issues/13017) and
[.../issues/21984](https://gitlab.torproject.org/tpo/applications/tor-browser/-/issues/21984);
**note:** GitLab's issue pages returned HTTP 403 to this research's automated fetches,
so these two claims rest on a search engine's indexed snippet of the GitLab page, not a
directly re-verified fetch of the page itself — treat the ticket numbers and existence
as confirmed, the exact wording as approximate). What did ship, per Mozilla's own
fingerprinting wiki (the "Tor Uplift" project that ports Tor's defenses into Firefox
proper), is **spoofing `AudioContext.outputLatency`** to a fixed value, not noise
injection into sample data
([MozillaWiki: Security/Fingerprinting](https://wiki.mozilla.org/Security/Fingerprinting)).
That's a real, citable divergence from Moat's own `noisifyFloatSamples` approach
(`src/content/fingerprintGuard.ts`), worth naming honestly rather than assuming Tor
does the same kind of noising Moat does.

**Fonts.** The design goal is stated in absolute terms: "Font-based fingerprinting MUST
be rendered ineffective." The mechanism is a whitelist, not noise: Windows and macOS
restrict enumerable fonts via a `font.system.whitelist` preference, Linux ships a
bundled `fonts.conf`, and Tor Browser bundles its own Noto font set on top of (or
instead of) OS-provided fonts, plus character-level fallback for glyphs outside the
whitelisted set
([Tor Browser Design, §4.6.6, "Fonts"](https://2019.www.torproject.org/projects/torbrowser/design/)).
Moat currently does nothing in this space — no font-enumeration limiting or
allowlisting exists in `fingerprintGuard.ts` today.

**Letterboxing (window-size quantization).** Tor Browser rounds the *content* window to
a multiple of 200×100 pixels, capped at 1000px per dimension, and dynamically adds
margins during resizes to keep users clustered into a handful of screen-size "buckets"
rather than exposing an arbitrary continuous resolution
([Tor Browser Design, §4.6.7, "Monitor, Widget, and OS Desktop Resolution"](https://2019.www.torproject.org/projects/torbrowser/design/)).
With `privacy.resistFingerprinting` on, content-relative coordinates are reported and
`window.devicePixelRatio` is forced to `1.0`. Mozilla's own fingerprinting wiki confirms
the same 200×100 rounding shipped into stock Firefox, plus "a warning is shown when
maximizing" the window (maximizing would otherwise reveal the real screen size)
([MozillaWiki: Security/Fingerprinting](https://wiki.mozilla.org/Security/Fingerprinting)),
and Mozilla's own Bugzilla tracks the implementation as a genuine window/layout-level
change (`layout.css.letterboxing`), i.e. actual gray bars added around the rendered
page, not a value returned by a JS getter
([Bugzilla 1407366](https://bugzilla.mozilla.org/show_bug.cgi?id=1407366)).

**Timing-attack mitigation / clock precision reduction.** Two separate mechanisms:
(1) Tor Browser sets `dom.event.highrestimestamp.enabled` to normalize
`Event.timeStamp` and clamps timer resolution to 100ms specifically "as an effective
means against system uptime fingerprinting"
([Tor Browser Design, §4.6.15, "System Uptime"](https://2019.www.torproject.org/projects/torbrowser/design/));
(2) Mozilla's own resistFingerprinting documentation states the general policy plainly:
**"Time Precision is reduced to 100ms, with up to 100ms of jitter"**
([MozillaWiki: Security/Fingerprinting](https://wiki.mozilla.org/Security/Fingerprinting)).
Mozilla frames the whole effort explicitly as porting Tor's work into Firefox: "The
anti-fingerprinting project is part of the Tor Uplift project. Its goal is to build up
the same level of fingerprinting resistance as the Tor Browser in Firefox," referencing
Tor's own design document as the spec to match
([MozillaWiki: Security/Fingerprinting](https://wiki.mozilla.org/Security/Fingerprinting)).

**Keyboard layout.** A less commonly discussed one: Firefox is patched (under Tor's
direction) to report `KeyboardEvent.code`/`KeyboardEvent.keyCode` as fixed
consensus/US-English-style values regardless of the user's actual layout, hides numpad
key usage, and reports empty `code`/zero `keyCode` for non-US-ASCII characters
([Tor Browser Design, §4.6.16, "Keyboard Layout Fingerprinting"](https://2019.www.torproject.org/projects/torbrowser/design/)).

**hardwareConcurrency / deviceMemory bucketing.** Tor's own tracker discusses "a more
elaborate defense against fingerprinting with `hardwareConcurrency`" using a bucketed
reporting approach for CPU core counts
(search-indexed content of
[gitlab.torproject.org/tpo/applications/tor-browser/-/issues/22127](https://gitlab.torproject.org/tpo/applications/tor-browser/-/issues/22127);
same GitLab-403 caveat as above applies). This is worth flagging only because it's a
point of *convergence*, not a gap: Moat's own `bucketDeviceMemory`/
`bucketHardwareConcurrency` (`src/content/fingerprintGuard.ts`) already does
conceptually the same bucketing, independently.

---

## 2. Cookie/storage isolation: first-party isolation vs. Total Cookie Protection

Tor Browser's mechanism is **First-Party Isolation (FPI)**, described in the design
document as "first party isolation of all browser identifier sources," where all state
is "scoped (isolated) using the URL bar domain" — a technique the document also calls
"double-keying" once combined with the third-party context
([Tor Browser Design, §4.5, "Cross-Origin Identifier Unlinkability"](https://2019.www.torproject.org/projects/torbrowser/design/)).
The scope is explicitly total: setting `privacy.firstparty.isolate` to `true` isolates
"cookies, cache, DOM storage, IndexedDB, HTTP auth, SharedWorkers, blob URIs, OCSP, and
favicons" by top-level site — i.e. everything, with no built-in exception list
([Tor Browser Design, §4.5](https://2019.www.torproject.org/projects/torbrowser/design/)).

Firefox's **Total Cookie Protection (dFPI, "dynamic" FPI)** is, in Mozilla's own words,
"an evolution of the First-Party-Isolation feature, a privacy protection that is
shipped in Tor Browser," built with credited collaboration from the Tor Project
([Mozilla Security Blog: Total Cookie Protection](https://blog.mozilla.org/security/2021/02/23/total-cookie-protection/)).
The mechanism is the same "separate cookie jar per website" idea — a cookie set by a
third party is "confined to the cookie jar assigned to that website, such that it is
not allowed to be shared with any other website" — but the *dynamic* part is the actual
difference from Tor's strict FPI: dFPI "makes a limited exception for cross-site
cookies when they are needed for non-tracking purposes, such as those used by popular
third-party login providers," granted only once the user actively engages with that
flow on that site
([Mozilla Security Blog: Total Cookie Protection](https://blog.mozilla.org/security/2021/02/23/total-cookie-protection/)).
So: **Tor's FPI is absolute and unconditional; Firefox's mainline descendant is the same
partitioning idea with compatibility exceptions carved out for known legitimate
cross-site flows.** Moat's existing Firefox-only toggle exposes Tor's original
`firstPartyIsolate` setting directly (per its own source), which is the *stricter* of
the two — Moat is not currently offering dFPI's more usable middle ground, but that's a
Firefox platform-behavior distinction, not something Moat's own code chooses between.

---

## 3. Popup/redirect handling: no bespoke anti-popup system

The one popup-related mechanism found in Tor's own design document is not a security
or annoyance feature at all — it's a fingerprinting defense wearing a popup-blocking
costume: "We force popups to open in new tabs (via
`browser.link.open_newwindow.restriction`), to avoid full-screen popups inferring
information about the browser resolution"
([Tor Browser Design, §4.6, discussion under "Monitor, Widget, and OS Desktop
Resolution"](https://2019.www.torproject.org/projects/torbrowser/design/)). The concern
is that a full-screen popup window's dimensions would leak the real screen resolution
around the letterboxing defense, not that popups are inherently malicious or annoying.
Beyond that, Tor Browser relies on standard Firefox popup blocking; no evidence in the
design document or manual describes a Tor-specific popup/redirect-blocking system
layered on top.

**NoScript's actual role.** Tor Browser's three Security Levels — Standard, Safer,
Safest — are implemented in part through NoScript, and the manual is explicit about
what each level does: at Standard, "all Tor Browser and website features are enabled";
at Safer, "JavaScript is disabled on all non-HTTPS sites," with some fonts and math
symbols also disabled and media becoming click-to-play; at Safest, "JavaScript is
disabled by default on all sites," alongside more fonts/icons/images and click-to-play
media
([Tor Browser Support: Security levels](https://support.torproject.org/tor-browser/features/security-levels/)).
The Tor Project's own FAQ frames *why* JavaScript is even left on by default in
Standard mode as a deanonymization-attack-surface tradeoff, not an ad/content concern —
JavaScript "can enable attacks on browser security which might lead to
deanonymization," and disabling it by default would cause most users to "give up on Tor
entirely"
(search-indexed content of
[support.torproject.org/tbb/tbb-34/](https://support.torproject.org/tbb/tbb-34/)).
NoScript in Tor Browser is a security/anonymity control, not an ad- or popup-blocking
feature, and it isn't marketed or documented as one.

---

## 4. New Identity / circuit isolation, and its WebExtension-shaped analogue

**New Identity** is a full session reset: it will "close all your open tabs and
windows, clear all private information such as cookies and browsing history, and use
new Tor circuits for all connections"
([Tor Browser Support: Managing identities](https://support.torproject.org/managing-identities/)).
**New Tor Circuit for this Site** is narrower and tab-scoped: it reloads only the
active tab over a fresh circuit and explicitly "does not clear any private information
or unlink your activity, nor does it affect your current connections to other
websites"
([Tor Browser Support: Managing identities](https://support.torproject.org/managing-identities/)).

The underlying compartmentalization principle, stated by Tor's own support docs: "all
connections to a single website address will be made over the same Tor circuit," while
"two different sites that use the same third-party tracking service" get "content...
served over two different Tor circuits, so the tracker will not know that both
connections originate from your browser"
([Tor Browser Support: Managing identities](https://support.torproject.org/managing-identities/)).
This is FPI's double-keying idea applied one layer down, at the network transport —
which Moat structurally cannot touch (Moat has no network layer of its own; it's a
content/request-filtering extension, not a proxy).

The part of "New Identity" that **is** WebExtension-shaped is the *storage-reset* half,
independent of any network component: closing tabs, clearing cookies/cache/storage, and
starting fresh. `browsingData.remove()` and `tabs` APIs can do exactly that from an
extension today, with no engine changes required — see Candidates §3 below.

---

## 5. What Tor Browser deliberately does not do

Two explicit non-goals, both stated directly in the design document, both directly
relevant to a project that *is* an ad/tracker blocker:

**No default ad blocking.** Section 2.3.5, "No filters," states Tor Browser avoids
"site-specific filter addons like AdBlock Plus," arguing "filter-based addons do not
add any real privacy" over a properly engineered general solution, and that
"development efforts should be focused on general solutions." More pointedly: "we are
also generally opposed to shipping an always-on Ad blocker" because doing so would
"damage our credibility in terms of demonstrating that we are providing privacy through
sound design alone"
([Tor Browser Design, §2.3.5, "No filters"](https://2019.www.torproject.org/projects/torbrowser/design/)).
This is a stated philosophical position, not an oversight — Tor Browser is explicit
that anonymity and ad-blocking are different goals it deliberately keeps separate, and
that stacking a filter-list-based ad blocker on top would undercut its own credibility
argument that privacy comes from browser design rather than curated lists.

**No extra add-ons, generally.** The Tor Project's own FAQ discourages installing *any*
additional extensions in Tor Browser at all, including privacy/security ones, for a
reason worth sitting with given Moat's context: an extra add-on "will increase the
attack surface" and, more importantly for fingerprinting, "may allow an attacker to
infect Tor Browser" or make "your Tor Browser fingerprint unique," which can itself
enable deanonymization
(search-indexed content of
[support.torproject.org/tbb/tbb-14/](https://support.torproject.org/tbb/tbb-14/)). The
self-referential tension this raises for Moat: Tor's whole uniformity argument only
works because (almost) everyone running Tor Browser has the *same* set of
fingerprinting defenses on by default. A fingerprint-resistance feature bolted onto one
particular ad-blocker extension, opted into by a minority of that extension's users,
cannot deliver that same population-level uniformity — it can make an install
*different from other Moat users* in a per-install way (which is what Moat's noised
approach already accepts, per its own code comments), but it cannot make a Moat user
blend into the general Chrome/Firefox population the way Tor Browser users blend into
each other. This isn't a reason not to have the feature — it's a reason to keep
describing it honestly as noise/obfuscation rather than as "Tor-grade" anonymity.

---

## Candidates for Moat

Each candidate is tagged **engine-level-only** (requires patching Firefox/Chromium
itself; a WebExtension cannot do this) or **WebExtension-reachable** (buildable within
a normal extension's APIs), per the task's own framing. None of these are re-statements
of already-shipped Moat features (canvas/AudioContext/WebGL noise, navigator
bucketing, Firefox `resistFingerprinting`/`firstPartyIsolate` pass-throughs).

1. **WebExtension-reachable: spoof window/screen dimension *properties* to Tor's own
   200×100 letterboxing formula, without real letterboxing.** True letterboxing (actual
   gray margin bars around the rendered viewport, and a real forced
   `devicePixelRatio`) is **engine-level-only** — a WebExtension has no API to resize
   the rendering surface independently of the real window, so this candidate is not
   "build letterboxing." It's narrower and more honest: override
   `window.innerWidth`/`innerHeight`/`outerWidth`/`outerHeight` and
   `screen.width`/`height` getters in the page's MAIN world — exactly the pattern
   `fingerprintGuard.ts` already uses for canvas/WebGL/navigator — to report values
   rounded down to the nearest 200×100 (Tor's own bucket size, per §1 above) instead of
   the real pixel dimensions. This closes the common case (a fingerprint script reading
   these documented JS properties) without touching actual layout. **Caveat, stated
   plainly:** the page's real CSS layout, scrollbar behavior, and anything measured via
   `getBoundingClientRect()` on real DOM elements still reflect the true window size, so
   a fingerprinter that cross-checks the spoofed API values against observed layout
   behavior can catch the lie — the same category of limitation Moat already accepts
   for its existing canvas/WebGL spoofs, not a new risk class.
   Source: [Tor Browser Design §4.6.7](https://2019.www.torproject.org/projects/torbrowser/design/), [MozillaWiki: Security/Fingerprinting](https://wiki.mozilla.org/Security/Fingerprinting).
   **Cost: small-to-medium** — same file, same architecture, a handful of new property
   overrides.

2. **WebExtension-reachable (for the common case only): clamp `performance.now()`,
   `Date.now()`, and `Event.timeStamp` to Tor/Firefox's own published figure of 100ms
   resolution plus jitter.** Monkey-patching these documented, JS-facing timing APIs in
   the MAIN world (same `maskAsNative` pattern already used elsewhere in
   `fingerprintGuard.ts`) catches the overwhelming majority of fingerprint scripts,
   which read timing exclusively through these calls. **Be honest about the ceiling
   here, per the task's instruction not to oversell:** this is explicitly *not* full
   parity with engine-level `resistFingerprinting`. A determined page can reconstruct a
   high-resolution clock through side channels a content-script patch cannot close —
   e.g. a busy-loop counter in a Worker using `SharedArrayBuffer`/`Atomics`, which reads
   real wall-clock progress without ever calling a patchable JS timing function.
   Firefox's own `resistFingerprinting` closes that class of leak by controlling the
   underlying timer/scheduler at the engine level, which is why this candidate is
   labeled **WebExtension-reachable for the common case, engine-level-only for the
   complete guarantee** rather than a clean win.
   Source: [Tor Browser Design §4.6.15](https://2019.www.torproject.org/projects/torbrowser/design/), [MozillaWiki: Security/Fingerprinting](https://wiki.mozilla.org/Security/Fingerprinting).
   **Cost: small** to build, but ships with a caveat that should be stated to users if
   ever surfaced as a claim ("reduces the common timing side-channel," not "eliminates
   timing fingerprinting").

3. **WebExtension-reachable: a one-click "fresh start" action modeled on the
   storage-reset half of New Identity.** Tor's New Identity is two things bundled
   together: a network-circuit reset (no WebExtension equivalent — Moat has no network
   layer, so this half is out of scope entirely, not just engine-level-only) and a
   storage/tab reset (close tabs, wipe cookies/cache/storage, start clean), which is
   plain `browsingData.remove()` plus `tabs` API calls — no engine changes needed. This
   is a much smaller idea than "New Identity" sounds like, and should be scoped and
   named as exactly that: a manual privacy-reset button, not a repackaging of Tor's
   anonymity guarantee.
   Source: [Tor Browser Support: Managing identities](https://support.torproject.org/managing-identities/).
   **Cost: small** — the API already exists; the work is UI/UX and deciding the default
   scope (current site vs. whole browser).

4. **WebExtension-reachable: add `AudioContext.outputLatency`/`sampleRate` spoofing
   alongside Moat's existing sample-noise approach.** Per §1, Firefox's actual shipped
   Tor-Uplift defense spoofs `outputLatency` to a fixed value — a property Moat's
   current `fingerprintGuard.ts` noise approach (noising sample data via
   `noisifyFloatSamples`) doesn't touch. These are complementary, not competing:
   noising sample data addresses buffer-content fingerprinting, spoofing
   `outputLatency`/`sampleRate` addresses a separate, documented vector fingerprint
   scripts read directly as properties.
   Source: [MozillaWiki: Security/Fingerprinting](https://wiki.mozilla.org/Security/Fingerprinting).
   **Cost: small** — one or two more property overrides in an existing file.

5. **Declined as a candidate: font-enumeration allowlisting matching Tor's exact
   model.** Already covered and correctly scoped down in
   `ad-blocker-architecture-and-roadmap.md` item 5 (Brave's hybrid model over Tor's
   hard allowlist, given Moat's existing per-install noise philosophy and lower
   breakage tolerance) — not re-litigated here, just cross-referenced so this document
   doesn't imply it's a new, separate suggestion.

6. **Not a candidate, named for completeness: Tor's canvas/WebGL
   permission-gate-or-blank-output model as a *replacement* for Moat's existing
   noise-injection approach.** Technically WebExtension-reachable (a content script can
   return blank ImageData or throw/refuse on `getContext('webgl')` just as easily as it
   can noise the output), but this would be a philosophy downgrade, not an upgrade, for
   Moat specifically: Tor's blank/refuse model works because it's paired with Tor's
   uniformity goal (every Tor user looks identical) and a userbase that already accepts
   broken canvas CAPTCHAs and WebGL content as a normal cost of using Tor. Moat's own
   code comments already identify canvas noise as "the one opt-in, occasionally-risky
   feature" specifically to minimize breakage (e.g. canvas CAPTCHAs) — switching to
   Tor's blank-output model would trade a currently-working compromise for a strictly
   more disruptive one, for no fingerprinting-strength benefit the current noise
   approach doesn't already deliver against non-Tor-uniformity threat models. Recording
   this as a deliberate non-candidate, in the same spirit as
   `ad-blocker-architecture-and-roadmap.md` item 9.

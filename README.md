<p align="center">
  <img src="icons/logo-banner.svg" width="64" height="64" alt="">
</p>

<h1 align="center">Moat</h1>
<p align="center"><strong>A quiet ad blocker and popup/redirect firewall for Chrome and Firefox.</strong></p>

<p align="center">
  <a href="https://github.com/Samuelabhinav37/moat/actions/workflows/ci.yml"><img src="https://github.com/Samuelabhinav37/moat/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <img src="https://img.shields.io/badge/manifest-v3-5fb896" alt="Manifest V3">
  <img src="https://img.shields.io/badge/browsers-chrome%20%7C%20firefox-5fb896" alt="Chrome and Firefox">
</p>

No nag screens, no "rate us" prompts, no onboarding tabs. It blocks things quietly and shows a
badge count.

> **Project status:** active development. Builds and automated tests cover Chrome and Firefox,
> but browser-store review, real-world compatibility, filter provenance, and dependency review
> remain part of every release decision.

## Contents

- [Features](#features)
- [Architecture at a glance](#architecture-at-a-glance)
- [How it works](#how-it-works)
- [Problems we hit and how we solved them](#problems-we-hit-and-how-we-solved-them)
- [Setup](#setup)
- [Loading it locally](#loading-it-locally)
- [Enterprise deployment](#enterprise-deployment)
- [Permissions](#permissions)
- [Privacy policy](PRIVACY.md)
- [Known limitations](#known-limitations)
- [Licensing note](#licensing-note)
- [Researched but not built yet](#researched-but-not-built-yet)

## Features

- **Network-level blocking** — ~274,000 rules across 11 AdGuard filter lists: ads, trackers,
  known-malicious/phishing/scam domains, cookie notices, and other annoyances.
- **Popup/redirect firewall** — silently drops hijacked new-tab popups and redirects, backed by a
  background tab safety net.
- **Cosmetic filtering** — hides the leftover ad containers and cookie banners that network-level
  blocking can't reach.
- **Real block-count breakdown** — the toolbar popup shows an Ads / Trackers / Popups split
  sourced from the browser's own rule-match feedback, not estimated (Chrome only for now).
- **Element picker** — "Block an element…" for anything the filter lists miss: hide it
  permanently, hide it just for this page load, or gray it out if hiding would break the layout.
- **Grayed-out video ads** — automatically dims YouTube's in-stream ads instead of leaving them
  full-color, since they play through the same player as real content and can't be blocked
  outright. On by default; best-effort by nature. YouTube's sidebar/in-feed "Sponsored" cards are
  hidden outright instead, since those are safe to remove without breaking layout.
- **Aggressive feed ad removal** (opt-in) — a live scanner for Instagram, LinkedIn, and YouTube
  that removes sponsored posts by their rendered "Sponsored"/"Ad"/"Promoted"/"Paid partnership"
  label as they render, since feeds randomize class names specifically to defeat fixed selectors.
- **Auto-reject cookie banners** (opt-in) — clicks through to "reject"/"decline" on the major
  consent platforms (OneTrust, Cookiebot, Didomi, and others) using a small interpreter for a
  declarative rule format, never arbitrary injected JS.
- **Per-site pause + master switch** — no nag UI anywhere.
- **Opt-in privacy toggles** — fingerprint resistance, third-party cookie blocking, and WebRTC
  leak protection, all off by default.
- **Filtering levels** — Off / Lite / Essential / Standard / Strict presets, plus per-list control.
- **Custom rules** — your own block and allow lists, on top of the bundled filter lists.
- **Enterprise-managed policy** — push settings org-wide via Chrome's `ExtensionSettings` or
  Firefox's `policies.json`.
- **Global Privacy Control** — sent as a legally binding opt-out signal in a dozen US states.
- **Leaked-password check** (opt-in) — warns inline when a password you type into a page has
  appeared in a known data breach, via HaveIBeenPwned's k-anonymity API (only a 5-character hash
  prefix ever leaves your device, never the password itself).
- **Settings export/import and opt-in cross-device sync** — back up your settings as a file, or
  mirror them across your own devices via `storage.sync`, both off by default.
- **Keyboard shortcut** (default Ctrl+Shift+M / Cmd+Shift+M) — toggle protection globally without
  opening the popup.
- **"Report a problem" button** — opens a pre-filled GitHub issue with just the site's hostname
  and your enabled filter groups, never the full URL.
- One codebase, Chrome and Firefox builds.

## Architecture at a glance

```mermaid
flowchart TD
    Nav["Page navigation"] --> DNR{"declarativeNetRequest<br/>static rulesets (~273k rules)"}
    DNR -->|"matches ads/trackers/malware list"| Blocked["Request blocked<br/>(network level, before it loads)"]
    DNR -->|"no match"| Loads["Request allowed through"]

    Loads --> DocStart["document_start content scripts"]
    DocStart --> Cosmetic["cosmeticFilter.ts<br/>fetch only the 1-3 domain-hash<br/>buckets this hostname needs,<br/>inject one &lt;style&gt; block"]
    DocStart --> Guard["mainWorldGuard.ts (MAIN world)<br/>wraps window.open + click hijacks,<br/>drops popups without a real gesture"]

    Loads --> DocIdle["document_idle content scripts<br/>(site-scoped, opt-in)"]
    DocIdle --> Dimmer["youtubeAdDimmer.ts<br/>grayscale in-stream video ads"]
    DocIdle --> Scanner["feedAdScanner.ts<br/>MutationObserver + label match,<br/>removes sponsored feed posts"]

    Blocked --> Background["background/index.ts<br/>(service worker)"]
    Guard --> Background
    Background --> Badge["Per-tab badge count"]
    Background --> Breakdown["Ads / Trackers / Popups<br/>breakdown (getMatchedRules)"]
    Background --> SafetyNet["Tab safety net:<br/>closes popups that slipped past<br/>the content-script guard"]
    Background --> LiveUpdates["Daily live redirect-domain<br/>refresh from GitHub"]
```

Network-level blocking (left branch) happens before a request ever loads. Everything else is
reactive to a page that already loaded — cosmetic hiding, the popup guard, and the opt-in
per-site features all run as content scripts, while the background service worker owns anything
that needs to persist across pages (the badge, the breakdown, the safety net, live updates).

## How it works

- **Network blocking** — ships `declarativeNetRequest` rulesets compiled
  from eleven AdGuard filter lists, refreshed from `@adguard/dnr-rulesets`:
  Base, Tracking Protection, URL Tracking, and Popups for ads/trackers;
  Online Malicious URL, Phishing URL, Scam, and Badware-risks for actual
  malware/phishing domains (this is the "firewall" half — it blocks known-bad
  sites outright, not just ads); Social Media, Cookie Notices, and Other
  Annoyances for the trackers/nags those don't otherwise catch. ~274,000
  rules total, well under Chrome's static-rule budget. This all runs in the
  browser engine, not a JS handler (which MV3 no longer allows for blocking).
  A small slice of these are `$redirect` rules that neutralize ad scripts by
  pointing them at a bundled no-op resource (`nooptext.js`,
  `1x1-transparent.gif`, etc.) instead of just blocking the request outright —
  `scripts/update-filters.mjs` vendors the ~30 resource files these rules
  actually reference straight out of `@adguard/scriptlets` (which ships
  exactly the set AdGuard's own rules point at) into
  `web-accessible-resources/redirects/`, declared in the manifest's
  `web_accessible_resources`, so these rules resolve instead of failing
  closed.
- **Real block-count breakdown** — the toolbar popup's Ads/Trackers/Popups strip is sourced from
  `declarativeNetRequest.getMatchedRules()` (the `declarativeNetRequestFeedback` permission),
  refreshed once per page load and mapped from the 11 filter-list groups above to three buckets.
  Real numbers, not estimates — they start at zero on a fresh page and fill in as the page's own
  requests get matched. Chrome-only for now: Firefox hasn't implemented `getMatchedRules` yet, so
  that slice stays at zero there while the popup/redirect firewall count below still works on both
  browsers (see `src/background/matchStats.ts` and `src/shared/matchedRuleCategories.ts`). A
  collapsed-by-default "By company" disclosure under the strip attributes as many of those matches
  as it can to the actual organization behind them (Google, Meta, Criteo, etc.), correlated at
  build time against Ghostery's TrackerDB by each rule's target domain — purely informational, no
  new decision asked of anyone, hidden entirely on requests TrackerDB doesn't cover (see
  `scripts/lib/ruleCompany.mjs` and `src/shared/matchedRuleCompanies.ts`).
- **Rule-match logger** — a development tool, not a user feature: `logger.html` (linked from
  Settings → About → Debugging) lists every request `declarativeNetRequest.onRuleMatchedDebug`
  saw on the active tab and which specific rule matched it, for diagnosing a filter or heuristic
  that's stopped working without guessing. Chrome only fires that event for extensions loaded
  unpacked (developer mode) — it stays empty on a Web Store install, and on Firefox, which
  doesn't implement it at all — so `src/background/ruleLogger.ts` feature-detects it and the page
  says so plainly rather than showing an empty table with no explanation.
- **Grayed-out video ads** — YouTube's in-stream ads share the same `<video>` element as real
  content, so they can't be network-blocked or cosmetically hidden without breaking the player.
  `src/content/youtubeAdDimmer.ts` (YouTube-scoped, on by default) watches `#movie_player` for two
  independent signals YouTube's own player already exposes -- the `ad-showing`/`ad-interrupting`
  class, and `.ytp-ad-module` having content -- and applies `filter: grayscale(1)` to the video
  while either is present. Verified live against a real ad on a news livestream (2026-08-23).
  That's a first-party observation of YouTube's own markup, not a third-party script -- see "Known
  limitations" for why this is still best-effort despite the two-signal check. YouTube's
  sidebar/in-feed "Sponsored" cards (`ytd-ad-slot-renderer` and friends) are hidden outright
  instead, added as first-party selectors in `scripts/update-cosmetics.mjs` since AdGuard's
  bundled ones weren't matching them live. The element picker's "Gray out" mode uses the dimming
  mechanism too (a saved selector list, `customGrayscaleRules` in Settings) for anything else
  hiding would break.
- **Aggressive feed ad removal** — a fixed selector, static or picked, can't follow Instagram,
  LinkedIn, or YouTube's infinite-scroll feeds, because all three randomize the class names on
  sponsored posts specifically to defeat exactly that kind of rule (confirmed live for Instagram's
  atomic CSS classes; LinkedIn has documented the same move to hashed CSS modules).
  `src/content/feedAdScanner.ts` (opt-in, off by default) takes the same approach a human would
  instead: a `MutationObserver` watches the feed for newly rendered posts, and
  `src/content/feedAdLabel.ts` checks each one for a text node that's an exact, case-insensitive
  match for "Sponsored," "Ad," "Promoted," or "Paid partnership" -- per *segment*, splitting on the
  separators feeds actually use between metadata (a post header often renders as one text node
  reading "Sponsored · 2h", the same way an organic post's is "username · 2h"), not a substring
  check, so a caption that mentions one of those words in a sentence won't trip it. A match walks
  up to the nearest known "whole post" ancestor (`article` on Instagram, `[role="listitem"]` on
  LinkedIn -- verified live against a real "Promoted" post, since the commonly-documented
  `[data-urn]`/`.feed-shared-update-v2` selectors turned out to be stale --
  `ytd-rich-item-renderer` and friends on YouTube) and hides it. Off by default because a
  label match carries a little more false-positive risk than a fixed selector -- for people who
  want feeds fully cleaned rather than just what static rules catch.
- **Auto-reject cookie banners** -- cosmetic filtering already hides banners that match a plain
  selector, but AdGuard's own Cookie Notices list mostly handles the "click reject for me" half
  via scriptlets: arbitrary injected JS Moat deliberately never executes (see "Popup/redirect
  firewall" above and the licensing note below for why that boundary matters). `src/content/
  consent/` is a from-scratch interpreter for [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)'s
  declarative rule format instead -- inert JSON describing which selector to click, never code to
  run, the same trust boundary as Moat's own cosmetic selectors. Every consent category defaults
  to reject (`consent/types.ts`'s `REJECT_ALL`), Consent-O-Matic's own out-of-the-box default too,
  not a stricter policy invented here. Ported by hand from their MIT-licensed source (`Tools.js`,
  `Matcher.js`, `Action.js`, `CMP.js`, `ConsentEngine.js`) rather than guessed from the schema
  alone -- two real schema-vs-implementation mismatches were caught doing that (a documented
  `styleFilter` field the actual code never reads, and `DOMSelection`'s nominally-recursive
  `{parent,target}` shape only ever being resolved one level deep in practice) and matched to
  what the shipped extension actually does, not what its schema aspirationally describes. Verified
  end-to-end in tests against the real, currently-vendored Cookiebot and OneTrust rules -- not
  just unit tests of the interpreter in isolation -- confirming the default-reject path clicks
  only "Decline"/unchecks pre-checked categories, never "Accept" (see `src/content/consent/
  engine.test.ts`). Deliberately narrower than upstream in a few places, each explained in that
  directory's file headers: no drag-simulated consent sliders, `close` is a safe no-op rather than
  `window.close()` (this only ever runs in the page's own tab, not a popup window), and no
  progress-dialog/PIP visual chrome, since Moat has nowhere it would show. Opt-in, off by default
  -- it's still clicking things on your behalf, closer in kind to the aggressive feed scanner
  above than to plain cosmetic hiding. Covers a few dozen of the most widely-reused consent
  platforms (`rules/dnr/consent-rules.json`, vendored by `scripts/vendor-consent-rules.mjs`), not
  Consent-O-Matic's separate 200+ per-site bespoke rule catalog.
- **Uncloak disguised trackers** (Firefox only, opt-in) — a CNAME-cloaked tracker hides behind a
  subdomain of the site you're on (e.g. `trk.example.com`) that secretly resolves elsewhere via
  DNS, specifically to defeat domain-based blocking -- the 274,000 static rules above never see
  the real destination, only the disguised first-party-looking hostname. Chrome has no
  DNS-resolution API for extensions at all, a hard platform gap (see "Known limitations"); Firefox
  exposes `dns.resolve()`, the same API uBlock Origin uses there for the same purpose.
  `src/background/cnameUncloak.ts` adds a blocking `webRequest.onBeforeRequest` listener (Firefox
  still allows this under MV3; Chrome no longer does) that, for a subresource request whose
  hostname shares the current page's own domain (the actual cloaking pattern -- a true
  third-party domain is already visible to and blockable by the static rules directly, so it's
  skipped, no DNS lookup needed), resolves the real canonical name and cancels the request if it
  leads into a known tracker destination (`rules/dnr/cname-cloak-destinations.json`, vendored from
  [NextDNS's public list](https://github.com/nextdns/cname-cloaking-blocklist)). Firefox's
  blocking listeners can return a `Promise` (supported since Firefox 52), so this resolves DNS
  per-candidate-request directly rather than needing a separate cache-warming pass. Off by
  default: it's a per-request DNS resolution with a different cost/trust profile than everything
  else here.
- **Global Privacy Control** — sends the `Sec-GPC: 1` header on every
  request (our own small rule, `ruleset_privacy-headers`) and exposes
  `navigator.globalPrivacyControl = true` in every page. As of 2026 this is
  a legally binding opt-out signal in a dozen US states. On Firefox we also
  flip its native `privacy.network.globalPrivacyControl` setting, which is
  likely more complete than our own header/property patch.
- **Popup/redirect firewall** — a content script injected into the page's
  own JS context (`world: "MAIN"`) wraps `window.open` and intercepts
  script-dispatched clicks on `target="_blank"` links. It only lets a new
  tab open when there's a genuine, recent, on-target user gesture behind it
  (checked via `navigator.userActivation` plus the actual clicked element,
  not just "some click happened somewhere recently"). Everything else is
  silently dropped — no browser popup-blocked notification bar, nothing.
- **Background safety net** — in case a popup slips past the content script
  (a frame our script never ran in, a race condition), the background worker
  watches newly created tabs and silently closes any that land on a domain
  from the AdGuard Popups/URL Tracking lists.
- **Per-site pause + master switch** — click the toolbar icon to pause
  protection on the current site, or open Settings for the full list and a
  master on/off switch. Nothing else asks for your attention.
- **Opt-in browser-wide privacy toggles** — Settings has two switches, off
  by default because they change behavior outside of what's on-screen:
  blocking third-party cookies and WebRTC IP-leak protection, both applied
  via the `privacy` API (`src/background/privacySettings.ts`). Chrome and
  Firefox expose third-party cookie blocking under genuinely different
  shapes; that file feature-detects and handles both.
- **Cosmetic filtering** — hides the leftover empty ad boxes and cookie
  banners `declarativeNetRequest` can't touch (it's network-only). A
  build-time script (`scripts/update-cosmetics.mjs`) downloads the raw
  filter-list text, parses standard `##selector`/`#@#`-exception cosmetic
  rules (skipping AdGuard/uBO scriptlets and CSS-injection/extended-selector
  syntax that need a JS engine, not a `<style>` tag — see the comment atop
  `scripts/lib/parseCosmeticRules.mjs`), and validates every surviving
  selector against jsdom so nothing invalid ships. Per-domain selectors are
  bucketed into 64 shard files by a hash of the domain name
  (`bucketForDomain`, kept identical between `scripts/lib/domainBucket.mjs`
  and `src/shared/domainBucket.ts`, cross-checked by a test that runs both),
  so a content script only ever has to fetch the 1-3 buckets its own
  hostname's domain chain hashes into — a real fix, not a micro-op: it cut
  the JSON fetched on every single page load from ~5.8MB to well under 1MB
  (see "Problems we hit and how we solved them" below). A content script
  (`src/content/cosmeticFilter.ts`, top frame only) injects the resulting
  selectors as `<style>` blocks at `document_start` — CSS rules, not a
  one-time DOM pass, so they keep hiding elements a site adds later (SPA
  navigation, lazy-loaded slots) without a MutationObserver. Per-domain and
  generic selectors go into two separate blocks so a one-time cleanup pass,
  triggered on `window`'s `load` event, can prune generic selectors that
  matched nothing anywhere in the final DOM without touching the
  intentionally-scoped per-domain block. This is a style-engine cleanup —
  fewer live selectors for the browser to keep evaluating on every later
  recalc, which matters most on long-lived SPA tabs like Instagram, YouTube,
  and LinkedIn — not a network optimization: the full generic set (~17k
  selectors) is still fetched and injected upfront exactly as before. Not a
  MutationObserver either — it runs once, after initial load, same
  "no persistent DOM watcher for cosmetic filtering" design as the rest of
  this feature (see `selectorsStillMatching` in
  `src/content/cosmeticSelectors.ts`).
- **Live redirect-domain updates** — the bulk of blocking (~273k rules)
  stays build-time/static; MV3's dynamic-rule budget is nowhere near large
  enough to hold that. But the popup/redirect domain list (currently ~460
  domains) is small enough to refresh daily: `src/background/liveUpdates.ts`
  fetches whatever's currently committed to `live/redirect-domains.json` on
  GitHub and applies it as dynamic `declarativeNetRequest` rules, on top of
  the bundled baseline. Publishing a refresh is just `npm run filters:update`
  + commit + push — there's no scheduled automation writing to the repo on
  its own, so this stays under your control. Settings shows the last
  successful check. This is fetched over HTTPS with no additional signature/
  hash pinning beyond that -- trust here is entirely GitHub account security
  plus TLS, standard for this class of feature but worth naming explicitly:
  these become live block rules for every installed copy within 24h of a
  push.
- **Emergency quick-fix channel** — the same daily refresh above also fetches
  `live/quick-fixes.json`, an AdGuard-"Quick Fixes filter"-style channel for
  patching an anti-adblock-circumvention script or a filter-breakage report
  without waiting on a full store review cycle. Reuses the exact same
  fetch/validate/`updateDynamicRules` pipeline and trust model as the
  redirect-domain list, not new infrastructure. Deliberately narrow: an
  entry can only block a request, allow-list one, or strip query params
  (`src/background/quickFixRules.ts`) — never redirect to an arbitrary URL,
  so a compromised feed can't turn this into traffic hijacking. Empty
  (`[]`) by default; Settings only mentions it when a fix is actually
  active, staying silent the rest of the time.
- **Opt-in fingerprint resistance** — a third toggle, off by default:
  deterministic per-install noise on canvas (`toDataURL`/`toBlob`/
  `getImageData`) and `AudioBuffer.getChannelData` reads, a generic WebGL
  vendor/renderer string in place of your real GPU, and
  `navigator.hardwareConcurrency`/`deviceMemory` rounded to common values.
  "Deterministic" matters here: the same canvas content on the same install
  always noises the same way, so a site re-reading it twice can't tell
  anything changed — but different installs get different noise, which is
  what actually defeats cross-site fingerprint correlation. Off by default
  because, unlike blocking, this is the one feature that can occasionally
  change what a page observes (e.g. a canvas-based CAPTCHA). A second,
  nested opt-in — **rotate noise every browser session** — switches the
  seed from the permanent per-install one to one stored in
  `browser.storage.session` (in-memory, cleared on browser/extension
  restart), closer to Brave's model: a fingerprint that never changes can
  itself become a durable cross-site identifier over time, which rotating
  trades off against sites seeing a different "device" on every restart.
  Off by default, layered under the parent toggle rather than replacing it,
  since the deterministic default is the safer one for compatibility.
  Content scripts can't reach `storage.session` until the background worker
  grants it access (`storage.session.setAccessLevel`, called once at
  startup); on the rare page load that races that call, this silently falls
  back to the permanent seed rather than failing (`src/content/bridge.ts`).
- **Filtering levels + per-list control** — Settings' Filter Lists tab has a
  preset picker (Off / Lite / Essential / Standard / Strict) and an on/off
  switch for each of the 11 bundled lists, grouped by category. Toggling one
  applies instantly via `declarativeNetRequest.updateEnabledRulesets` — no
  rebuild, no reinstall. Picking a preset that doesn't match your current
  switches shows as "Custom," the same way an OS power-plan picker detects
  manual drift (`src/shared/filterPresets.ts`). A genuinely fresh install
  starts on Lite rather than the implicit "every group on" default — see
  Known Limitations below for why.
- **Custom rules** — the Custom Rules tab lets you block or allow-list
  specific sites yourself, applied as dynamic `declarativeNetRequest` rules
  (`src/background/customRules.ts`) in their own reserved id range so they
  never collide with the live-update rules above.
- **Element picker** — "Block an element…" in the toolbar popup turns on a
  hover-and-click picker (`src/content/elementPicker.ts`) covering both of
  uBlock Origin's manual tools in one flow: **Hide on this site** saves the
  generated selector (`src/content/generateSelector.ts` — prefers a stable
  id, then stable classes, then a short structural path, rejecting
  generated-looking identifiers along the way) so it's reapplied on future
  visits, same mechanism as the bundled cosmetic rules; **Hide for now**
  applies immediately but nothing is saved, gone on the next reload — uBO's
  Zapper behavior. Picks are listed under Custom Rules → Hidden elements.
- **Enterprise-managed policy** — an admin can push settings across an
  organization via Chrome's `ExtensionSettings` policy or Firefox's
  `policies.json` `3rdparty` key (schema: `src/managed_schema.json`):
  force protection on, lock the filter-list toggles, or add an org-wide
  blocklist on top of whatever the user's already added. Locked controls
  show a "Managed by your organization" badge instead of silently
  overriding the user with no explanation.
- **Leaked-password check** (opt-in, off by default) — a content script watches password fields
  for input and, via `src/background/pwnedPasswords.ts`, checks the typed password against
  HaveIBeenPwned's Pwned Passwords API using k-anonymity: only the first 5 characters of the
  password's SHA-1 hash are ever sent, HaveIBeenPwned returns every suffix that shares that
  prefix, and the match against the full hash happens locally — the actual password or its full
  hash never leaves the device. A match shows a small, non-blocking inline tooltip; the field is
  never cleared or blocked either way. Top-frame only, so a cross-origin login iframe isn't
  covered. Off by default since, unlike everything else in Settings, this is the one toggle that
  sends something derived from what you actually type.
- **Settings export/import** — the About tab's "Backup & restore" section downloads current
  settings as JSON (excluding the per-install fingerprint-resistance identifier) or validates and
  applies an uploaded file field-by-field, rejecting anything malformed outright rather than
  partially applying it. Export always reads raw settings, never the managed-policy-merged view,
  so a locked organizational value can never be captured and later "restored" as if it were a
  personal preference.
- **Opt-in settings sync** — a second Backup & restore toggle mirrors settings across your own
  devices via `storage.sync` (last-write-wins, not live real-time merge); a fresh install seeds
  itself from an existing synced copy if one exists. Off by default. The per-install
  fingerprint-resistance identifier is deliberately never synced, for the same reason it's
  excluded from export.
- **Keyboard shortcut** — Ctrl+Shift+M / Cmd+Shift+M by default, toggles protection globally the
  same as the popup's master switch, rebindable at `chrome://extensions/shortcuts`. No extra
  visual feedback beyond the badge change, consistent with the rest of Moat's "no nag UI" stance.
- **"Report a problem" button** — in the popup, opens a pre-filled GitHub issue containing only
  the current site's hostname (never the full URL, so tracking/session query params never end up
  in a public issue) and the filter groups currently enabled globally. Built from the same
  cross-browser, cheap data as the rest of the popup, not Chrome-only `getMatchedRules`, so it
  behaves identically on both browsers.
- **Localization infrastructure** — all user-facing strings in the popup and options page route
  through `_locales/en/messages.json` and `browser.i18n.getMessage()` rather than being hardcoded,
  the standard WebExtension i18n mechanism. English-only for now; this is the plumbing a future
  translation would drop into, not a translation itself.

See `src/` for the source layout: `background/` (service worker / event
page), `content/` (the three content scripts — `mainWorldGuard.ts` for the
page-context popup guard, `bridge.ts` for the isolated-world relay to
extension storage/messaging, `cosmeticFilter.ts` for element hiding),
`popup/` and `options/` (UI), `shared/domainChain.ts` (the "is this hostname
this domain or a subdomain of it" check used by both the popup safety net
and cosmetic filtering), `types.ts` (shared message/settings shapes), and
`scripts/manifest.ts` (builds `manifest.json` per browser target). The
heuristics with the most test coverage each live in their own
side-effect-free module so they're importable without a browser
environment: `content/isPlausibleTrigger.ts` (the popup-firewall trigger
check), `background/redirectDomainMatch.ts` (the tab safety net's domain
matcher), and `content/cosmeticSelectors.ts` (which selectors apply to a
given hostname) — all thin wrappers imported by the files that actually
register listeners or touch the DOM. Same pattern for the newer additions:
`shared/filterPresets.ts`, `background/filterGroupState.ts`,
`background/managedPolicyMerge.ts`, and `shared/rulesetManifest.ts` are all
pure and directly tested; `background/filterGroups.ts`,
`background/applyCustomRules.ts`, and `background/managedPolicy.ts` are the
thin browser-API wrappers around them.

See `CHANGELOG.md` for what shipped in each version, or the in-extension
About tab (Settings → About) for a shorter version plus the privacy policy.

## Problems we hit and how we solved them

Most of these were found by actually driving the extension in a real browser against a real
site, not by reading the DOM structure off a blog post — the sites in question (Instagram,
LinkedIn, YouTube) all obfuscate or shift their markup in ways that make static assumptions
unreliable. Keeping this list around so the same investigation doesn't happen twice.

| Problem | Why it happened | How we solved it |
| --- | --- | --- |
| YouTube ad dimming looked broken | The setting defaulted to **off** — nobody had opted in, no code bug | Verified live against a real ad, confirmed detection worked once enabled, flipped the default to on, and added a second independent detection signal so one YouTube markup change can't silently disable it |
| YouTube's sidebar "Sponsored" cards stayed fully visible | AdGuard's bundled cosmetic selectors didn't match YouTube's current sidebar markup | Added first-party selectors (`ytd-ad-slot-renderer` and friends) directly in `scripts/update-cosmetics.mjs` rather than waiting on an upstream filter-list update |
| The feed scanner did nothing at all on LinkedIn | Its content script's `matches` list only covered Instagram and YouTube — LinkedIn was never in scope, this wasn't a selector bug | Added LinkedIn's URL pattern to `scripts/manifest.ts` |
| The feed scanner still missed LinkedIn posts once it *was* in scope | The commonly-documented `[data-urn]` / `.feed-shared-update-v2` container selectors turned out to be stale | Live DOM inspection found the real current wrapper is `[role="listitem"]`; added it as the primary selector and kept the old two as harmless fallbacks |
| Instagram's "Sponsored" label matched inconsistently | The label shares one text node with adjacent metadata — a post header renders as a single node reading `"Sponsored · 2h"`, the same way an organic post's is `"username · 2h"` | Split on the separators these feeds actually use (bullet, middle dot, vertical bar, or `" - "`) and matched each segment exactly, instead of loosening to a substring check that could start matching prose |
| Cosmetic filtering fetched ~5.8MB of JSON on every single page load | Per-domain selector files were sharded purely by file size (`chunkBySize`), unrelated to which site was actually open — every page fetched every domain's rules | Replaced size-based chunking with domain-hash bucketing (`bucketForDomain`), so a page now fetches only the 1-3 shard files its own hostname needs — verified live against a served build: ~700KB instead of ~5.8MB for a typical page |
| Live redirect-domain updates silently stopped refreshing after the rename | The GitHub repo was made private mid-project, breaking the unauthenticated `raw.githubusercontent.com` fetch `liveUpdates.ts` relies on | Flagged rather than fixed — repo visibility is a real decision (source availability, not just this feature), left for a deliberate call rather than changed unilaterally |

## Setup

```
npm install
npm run filters:update   # pulls the AdGuard DNR rulesets into rules/dnr/
npm run validate:rules   # sanity-checks them (schema, duplicate ids)
npm run build             # builds dist/chrome and dist/firefox
```

Re-run `npm run filters:update` periodically to pick up newer filter rules
(the underlying package publishes new rulesets frequently). It runs two
steps: `update-filters.mjs` copies the prebuilt DNR rulesets out of
`node_modules` (no network needed), then `update-cosmetics.mjs` downloads
the raw filter-list text from AdGuard's CDN to extract cosmetic rules from
(this one does need network access, including in CI).

`npm run dev:chrome` / `npm run dev:firefox` rebuild on file changes
(static assets — icons, rulesets, manifest — are only copied once at
startup of the watch, so re-run the plain build if those change).

`npm run test` runs the unit test suite (Vitest) — mainly the pure logic
behind the popup-firewall heuristic, the redirect-domain matcher, the
filter-chunking used to stay under Firefox's file-size lint limit, the
Chrome/Firefox privacy-API branching, and the match-rule-to-category
mapping behind the popup's block-count breakdown. `npm run typecheck` runs
`tsc --noEmit`. `.github/workflows/ci.yml` runs all of the above plus a
full build and the Firefox lint on every push.

`npm run zip` produces `chrome.zip` and `firefox.zip` for store upload.

`filters:update` also writes `live/redirect-domains.json` — unlike
`rules/dnr/` (build output, gitignored), this one is a tracked file:
committing and pushing it is how a refreshed redirect-domain list reaches
already-installed copies of the extension (see "Live redirect-domain
updates" above) without a new store release.

## Loading it locally

**Chrome / Edge / Brave:** open `chrome://extensions`, enable Developer
mode, click "Load unpacked", and select `dist/chrome`.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load
Temporary Add-on", and select `dist/firefox/manifest.json`. (Temporary
add-ons are removed when Firefox restarts; for a persistent local install
you'd need to sign it through AMO, even for self-distribution.)

## Enterprise deployment

An admin can push policy via Chrome's `ExtensionSettings` policy (Group
Policy / Chrome Browser Cloud Management) or Firefox's `policies.json`
`3rdparty` key, targeting this extension's id and setting values matching
`src/managed_schema.json`. Chrome example (`ExtensionSettings` policy value,
keyed by extension id):

```json
{
  "<extension-id>": {
    "installation_mode": "force_installed",
    "update_url": "https://clients2.google.com/service/update2/crx",
    "policy": {
      "forceEnabled": true,
      "lockFilterGroups": true,
      "managedFilterGroups": { "ads": true, "trackers": true, "malicious-urls": true },
      "managedCustomBlockedDomains": ["known-bad-domain.example"]
    }
  }
}
```

Firefox equivalent goes under `3rdparty.Extensions["<extension-id>"]` in
`policies.json` with the same `policy` object shape. I built and unit-tested
this against the documented policy mechanism but haven't verified it against
a real managed browser profile — worth a manual check (`chrome://policy`
shows whether Chrome picked up the value) before relying on it in production.

### Athena integration (enterprise-only, off for every other install)

Moat ships the client half of an optional integration with
[Athena](https://github.com/Samuelabhinav37/Athena), a self-hosted identity-governance platform —
one piece of a wider three-project design (Athena, Moat, and a Gmail/Outlook triage extension)
planned separately from either project's own repository. This has **no Settings toggle** and cannot be turned on
by a user at all; it only exists to be provisioned by an organization's own device-management
policy, and every normal, personal, or open-source install of Moat behaves exactly as documented
everywhere else in this README with it entirely absent.

Add an `athena` object (see `src/managed_schema.json`) to the same managed policy shown above:

```json
"policy": {
  "athena": {
    "tenantId": "acme",
    "agentId": "<agent id returned by Athena enrollment>",
    "bootstrapUrl": "https://athena.acme.example/v1/security/agent-token",
    "bootstrapSecret": "<provisioned by your Athena deployment, scoped to this org only>",
    "eventsUrl": "https://athena.acme.example/v1/security/events",
    "policyUrl": "https://athena.acme.example/v1/security/policies/latest",
    "policyPublicKey": { "kty": "OKP", "crv": "Ed25519", "x": "<base64url key>" }
  }
}
```

Once present, `src/background/athenaIntegration.ts` exchanges `bootstrapSecret` for a short-lived
session token (cached in `browser.storage.session` — in-memory, never `local`/`sync`, the same
pattern already used for the per-session fingerprint-rotation seed), and every five minutes flushes
the bounded local queue as individual idempotent security events: one for each request already blocked by the
malicious-urls/phishing-urls/scam/badware filter lists specifically (not ordinary ads/trackers,
which never generate an event), and one for each popup/redirect-firewall catch (the one source that
also works on Firefox, where `getMatchedRules` doesn't exist). Every event carries a category, a
risk tier, an opaque `{rulesetId, ruleId}` reference into the bundled filter data, and a timestamp —
never the URL, page content, or browsing history involved. Blocking itself never waits on any of
this: by the time an event is queued, the block it describes has already happened locally, and a
flush failure (Athena unreachable) just leaves the queue for the next attempt.

Athena now exposes the enrollment, token, event, and policy endpoints above. Policy artifacts are
verified with the managed Ed25519 public key before Moat changes dynamic rules; invalid or
unreachable updates retain the last-known-good rules. Athena-sourced blocks use a separate warning
page and a reported mistake remains an audited request rather than an immediate local bypass.

## Permissions

| Permission | Why |
| --- | --- |
| `<all_urls>` (host permission) | So the content-script firewall runs on every page and `declarativeNetRequest` can act on every request. |
| `tabs` | To read the URL/opener of newly created tabs for the popup safety net, and to show the right badge count per tab. |
| `webNavigation` | To detect when a page spawns a new tab/window, and when a page finishes loading (to refresh the block-count breakdown). |
| `declarativeNetRequest` | The core network-blocking engine. |
| `declarativeNetRequestFeedback` | Read-only match feedback for the popup's Ads/Trackers/Popups breakdown (`getMatchedRules`) — Chrome only, see "How it works" above. |
| `storage` | The paused-sites list and switches, stored locally only. Nothing is sent anywhere. |
| `privacy` | Only used by the two opt-in toggles above; unused (and invisible to the user) unless one is turned on. |
| `alarms` | Schedules the once-a-day live redirect-domain-list refresh. |
| `dns` (Firefox only) | Real CNAME resolution for "Uncloak disguised trackers" — off by default, and the permission itself has no effect unless that toggle is on. Not requested on Chrome, which has no equivalent API. |
| `webRequest` + `webRequestBlocking` (Firefox only) | Needed to actually cancel a request once its resolved CNAME target matches a known tracker — declarativeNetRequest can't act on an async DNS lookup mid-request. Chrome no longer allows blocking `webRequest` under MV3 at all; Firefox still does. |

See [PRIVACY.md](PRIVACY.md) for the full privacy policy: what data Moat
collects (none) and the two narrow cases where its own code talks to a
network at all.

## Known limitations

- **The block-count breakdown is Chrome-only.** Firefox hasn't implemented
  `declarativeNetRequest.getMatchedRules()` yet, so the Ads/Trackers/Popups
  strip stays at zero there. The popup/redirect firewall count (the
  "Popups" bucket's other half) still works on both browsers.
- **CNAME-cloaked tracker uncloaking is Firefox-only, the other direction.** Chrome has no
  DNS-resolution API for extensions at all -- not a missing permission, no such capability exists
  to request. "Uncloak disguised trackers" in Settings simply isn't offered there.
- **The YouTube ad dimmer is a DOM heuristic, not a guarantee.** It checks two independent
  signals (see "How it works"), which makes it more resilient than relying on one, but it's still
  dependent on YouTube's current markup. YouTube changes its markup periodically without notice;
  when it does, this can silently stop matching until it's updated. On by default since it's
  visual-only and doesn't break anything if it misfires, but it's still a real toggle for exactly
  that reason -- turn it off in Settings if it ever does.
- **The aggressive feed scanner only catches a label that renders as one plain, isolated text
  node.** If Instagram or YouTube ever split "Sponsored" across multiple `<span>`s the way Facebook
  is known to (to defeat exactly this kind of text match), this stops catching it until that's
  accounted for. It's also English-only right now -- a non-English UI language won't match. Off
  by default for these reasons, on top of the general false-positive risk of matching by label
  rather than by a fixed selector.
- **Chrome only guarantees 30,000 enabled static DNR rules per extension
  (`GUARANTEED_MINIMUM_STATIC_RULES`); Moat ships roughly 271,000 across its 19
  rulesets** (this exact number drifts with every `@adguard/dnr-rulesets` update --
  see `npm run filters:update`'s own output for the current count; already-redundant
  rules are pruned automatically at build time, see
  `docs/research/dnr-rule-consolidation-audit.md`). Rules beyond that guaranteed floor come from a pool shared
  across every extension installed in the browser, so on a machine running
  several other rule-heavy ad blockers or privacy extensions -- or where
  that shared pool is simply small on its own -- some of Moat's filter
  lists can fail to enable. `declarativeNetRequest.updateEnabledRulesets()`
  is atomic (all-or-nothing for whatever's requested in one call), so
  `src/background/filterGroups.ts` doesn't just try once and give up: it
  retries with the least-essential lists dropped first (annoyance/cosmetic
  categories, then ads/trackers, security last) until something fits,
  rather than an all-or-nothing failure leaving every list disabled when
  most of them would easily fit alone. The Filter Lists tab in Settings
  then shows exactly which lists got left disabled (or, if even the single
  highest-priority list didn't fit, Chrome's own remaining-rule count), and
  each affected list's own row gets a "Not active (rule budget)" badge --
  never a toggle silently shown as "on" while doing nothing. There is no way to
  raise the ceiling itself from within a single extension: the budget is a
  browser-wide, cross-extension limit. A genuinely fresh install (detected via
  `browser.runtime.onInstalled`'s `details.reason === "install"`) now seeds the
  much smaller "Lite" preset (~89,000 rules) instead of the implicit "every
  group on" default (~276,000 rules) specifically to make hitting this ceiling
  less likely from day one -- see `applyFreshInstallDefaults` in
  `src/background/settings.ts`. It doesn't raise the ceiling either, and the
  retry loop above still exists for whatever's left.
- **`web-ext lint` warnings on the Firefox build are expected and benign:**
  one is a Firefox-for-Android version nuance from bumping
  `strict_min_version` to 140 for `data_collection_permissions` support; one
  (`COINMINER_USAGE_DETECTED`) is the linter's naive keyword scanner
  tripping over a cryptominer *domain name* inside the AdGuard Base filter's
  own block rules (the file is static JSON blocking that domain, not code
  that runs it); and three (`UNSUPPORTED_API`) are the `getMatchedRules` gap
  noted above plus its debugging-tool cousin, `onRuleMatchedDebug` (see the
  rule-match logger below) — Firefox implements neither, and both are
  feature-detected before use so this is a dead reference, not a runtime
  failure.

## Licensing note

Moat's own code is licensed under [GPL-3.0](LICENSE) — chosen to match the license
already covering the bundled AdGuard/EasyList filter data below, so the whole
distributed package sits under one consistent copyleft license rather than mixing
license families.

The bundled filter lists are distributed under GPL-3.0 by AdGuard/EasyList
contributors. If you publish this extension, keep the attribution above and
check current license terms before distributing `rules/dnr/*.json` — that
data isn't original to this project.

The company names behind the popup's optional "By company" breakdown come from
[Ghostery's TrackerDB](https://github.com/ghostery/trackerdb) (`@ghostery/trackerdb`),
licensed [CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — free
for non-commercial use, which Moat is. If that ever changes, this needs revisiting
before shipping a build that still includes `rules/dnr/rule-companies.json`.

The cookie-banner rule data behind "Auto-reject cookie banners" is vendored from
[Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) (Aarhus University CAVI),
MIT-licensed. Moat's interpreter for that rule format (`src/content/consent/`) is
written from scratch against their published schema and source, not copied — see that
directory's own file headers for exactly what's ported faithfully and what's
deliberately different.

The known CNAME-cloak-destination domains behind "Uncloak disguised trackers" come from
[NextDNS's cname-cloaking-blocklist](https://github.com/nextdns/cname-cloaking-blocklist),
MIT-licensed.

## Researched but not built yet

From a pass on what a more complete privacy tool would also do:

- **Instagram Stories ads.** The aggressive feed scanner deliberately doesn't touch these, and
  that's a real scoping decision worth recording, not an oversight. Investigated live: a Stories
  ad renders as a full-screen slide inside the *same* viewer component that shows real stories —
  there's no separate "ad container" the way there is in the main feed. Applying the feed
  scanner's usual technique (hide the matched container) to a Stories ad would blank the entire
  full-screen viewer, including the real stories around it, since they all share one container.
  The correct fix is a different mechanism entirely — detect the ad slide and auto-advance past
  it, the way you'd tap through it manually — which is closer to "act on the page" than "hide an
  element," a bigger trust/scope step than anything else this scanner does. Not built without an
  explicit decision to take that step; documented here so the next pass doesn't rediscover this
  from scratch by trying the container-hide approach again and wondering why the viewer goes
  blank.
- **Font-enumeration fingerprinting** isn't covered by the fingerprint-
  resistance toggle — canvas, audio, WebGL, and the two navigator hints are.
  This one's a real architectural gap, not just an unimplemented feature:
  Brave's approach (exposing only a randomized subset of user-installed
  fonts) works because Brave patches font enumeration in the browser
  engine's own C++ layer, something no extension can do. The actual
  detection vector fingerprinters use — render invisible text in a
  candidate font, compare its measured width against a fallback via
  `offsetWidth`/`getBoundingClientRect` — has no dedicated, interceptable
  JS API the way canvas/audio reads do; those are generic layout properties
  every page's ordinary code depends on, so noising them broadly risks real
  site breakage in a way nothing else Moat's fingerprint guard touches
  does. Not implemented for that reason, not because nobody looked.
- **uBlock Origin's per-site dynamic-filtering "firewall matrix."** A real, shipped, sourced
  technique -- a full matrix UI letting an "advanced user" set global vs. per-site allow/block
  rules down to individual third-party domains contacted by the current page. Explicitly declined
  on philosophy grounds, not technical infeasibility: this is real decision-delegation to the user
  at a granularity Moat's "decide nothing for the user by default, quiet" stance directly argues
  against. uBO itself gates it behind an explicit "I am an advanced user" opt-in for the same
  reason. Recording the decision the way Instagram Stories is recorded above, rather than leaving
  it as silent absence.
- **Ghostery's `fetch`-monkeypatching approach to dynamic request modification.** MV3's
  `declarativeNetRequest` can't do the data-driven request rewriting (stripping identifying
  params, not just block/allow) Ghostery's tracker protection relies on, so their stated approach
  is replacing built-in browser APIs like `fetch` from a content script to claw some of that back
  -- by their own admission, this "introduces site-breakage risks and latency." A materially
  bigger trust/breakage step than anything Moat already does (including the popup firewall's
  `window.open` wrapper, which only intercepts a narrow, specific call, not a page's entire
  networking surface). Declined for the same reason as the firewall matrix above: a real,
  considered technique, not a gap nobody noticed.

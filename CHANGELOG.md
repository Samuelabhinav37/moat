# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.11.23

### Added
- **A fresh install now starts from a much smaller "Lite" filter preset instead of implicitly
  enabling every filter group.** `filterGroups: {}` (the untouched default) reads as "every group
  on" -- summing Moat's 11 bundled groups comes to roughly 276,000 rules, about 9x the 30,000
  static rules Chrome guarantees any one extension, with the rest drawn from a budget shared across
  every installed extension (see the graceful-degradation work in 0.11.19-0.11.22). A brand new
  install now seeds `filterGroups` to the new "Lite" preset (~89,000 rules: Essential's ads/popup/
  malware/scam coverage, minus the single largest security list) via
  `browser.runtime.onInstalled`'s `details.reason === "install"` -- the one signal that
  distinguishes a true fresh install from every later browser restart or extension update, which
  are left untouched. Existing installs are unaffected; a synced settings copy from another device
  (`seedFromSyncIfEmpty`) still takes priority over the new default when one exists. "Lite" is also
  now a selectable preset in Settings alongside Off/Essential/Standard/Strict, not just an
  install-time default.
- Moved `filterPresets.ts` from `src/options/` to `src/shared/` (pure module, no browser APIs) --
  the background bundle now needs it too, to apply the "Lite" preset on fresh installs.

## 0.11.22

### Fixed
- **A filter list's toggle could show "on" while actually being inactive**, with no per-row
  indication -- only a summary line at the top of the tab named which lists the rule-budget retry
  had to drop. Prompted by the reasonable question of what a toggle is even for if it doesn't
  reflect what's really happening: each row for a list in `droppedGroups` now shows a "Not active
  (rule budget)" badge next to its name, so it's obvious at a glance which specific toggles aren't
  actually doing anything right now, not just a general warning above the whole list.

### Added
- **Stress-tested the drop-priority logic with Moat's real 11 filter groups and their actual
  bundled rule counts**, not just small toy examples -- specifically because a toy example is what
  let the front/back drop-direction bug (v0.11.20 to v0.11.21) through review undetected. New tests
  assert every annoyance-category group ranks before every ads-category group before every
  security-category group across the full real set, and simulate the actual retry loop under a
  constrained budget to confirm no security group is ever dropped while a non-security group
  remains enabled.

## 0.11.21

### Fixed
- **v0.11.20's graceful-degradation fix dropped security lists first instead of last -- the exact
  opposite of what it was supposed to do.** Confirmed live: a user's Settings showed "Phishing URL
  Blocklist, Online Malicious URL Blocklist, uBlock Origin - Badware risks, Scam Blocklist" left
  disabled, while annoyance/ads/tracker lists stayed on. `orderGroupsByDropPriority` correctly
  orders groups least-essential-first, but `filterGroups.ts`'s retry loop was dropping from the
  *end* of that list (`slice(-drop)`) instead of the front -- security, sorted last because it's
  meant to be kept longest, was actually removed first. Fixed to drop from the front
  (`wantOn.slice(drop)` / `wantOn.slice(0, drop)`). Added a regression test
  (`filterGroups.test.ts`) mocking a tight budget and asserting the annoyance-category list is
  dropped before the security-category one -- this test fails against the previous code.

## 0.11.20

### Fixed
- **A tight shared static-rule budget could leave every filter list disabled, not just the ones
  that didn't fit.** Found via live troubleshooting: a user's browser reported only 374 static
  rules available across every installed extension -- Moat's own ~274,000-rule footprint, not
  competing extensions, was the actual ceiling. `declarativeNetRequest.updateEnabledRulesets()` is
  atomic (the whole requested change succeeds or the whole thing rejects), so the previous
  single-attempt call could fail completely and leave *nothing* enabled even when most lists would
  have fit comfortably alone. `src/background/filterGroups.ts` now retries, dropping the
  least-essential lists first (annoyance/cosmetic categories, then ads/trackers, security last --
  see the new `orderGroupsByDropPriority` in `filterGroupState.ts`) until something fits, so a tight
  budget degrades gracefully instead of collapsing to zero protection.
- **The Filter Lists warning now names exactly which lists got left disabled**, instead of a
  generic "something didn't fit" -- or, on total failure, Chrome's own real remaining-rule count
  (added in v0.11.19) rather than a vague warning.

## 0.11.19

### Added
- **The filter-list rule-budget warning now shows a real number.** Prompted by live troubleshooting
  where the warning persisted after removing other extensions -- with no diagnostic beyond a
  boolean "something didn't fully apply," there was no way to tell "genuinely out of shared budget"
  from "some other, unrelated `updateEnabledRulesets` failure" from the outside. `filterGroups.ts`
  now also captures `declarativeNetRequest.getAvailableStaticRuleCount()` when the call fails, and
  Settings' Filter Lists tab shows it: "Chrome currently reports N static rules still available
  across every installed extension." A near-zero number even with no other extensions installed
  means Moat's own bundled rule count is the actual ceiling, not extension competition -- steers
  toward turning off a filter list instead of hunting for more extensions to disable.

## 0.11.18

### Fixed
- **Popup had too many competing colors** -- bright neon-green "Reload page" and bright-red
  "Block an element…" buttons, plus a brown/tan "Paused on" banner and paused-state dot, on top
  of the existing blue "protected" state. Researched Ghostery's actual design tokens
  (`ghostery/ghostery-extension`'s `src/ui/styles.css`/`components/button.js`) for comparison:
  their buttons default to a neutral/outline style and reserve solid color for real semantic
  meaning, and their own pause state uses the same neutral/brand treatment as everything else --
  no separate warning color. Applied the same restraint here: both action buttons now use the
  existing neutral `.secondary` style (same treatment as "Report a problem…"), and the paused
  banner/dot use a neutral gray instead of brown -- pausing on a site isn't a warning state.
- **Action buttons still looked oversized after the previous pass** -- reduced padding, font size,
  and font weight (700 to 600) to match Ghostery's own button proportions more closely.

## 0.11.17

### Fixed
- **Popup's "Reload page"/"Block an element…" buttons looked oversized and pill-shaped** --
  `border-radius: 999px` on generous padding read as circular rather than as a button. Toned down
  to a standard rounded rectangle (`border-radius: 10px`, tighter vertical padding).

## 0.11.16

### Removed
- **Reverted the popup company drill-down and report-card summary line from v0.11.13**, per
  direct feedback that the popup UI change wasn't wanted. `src/popup/popup.ts`/`popup.html` are
  back to the pre-0.11.13 layout: a flat, non-interactive "By company" list and no summary line
  above the Ads/Trackers/Popups breakdown. The supporting build-time output
  (`rules/company-info.json`) and its generation code are removed with it, since nothing else
  used that data.

## 0.11.15

### Added
- **Opt-in per-session fingerprint noise rotation** (item g of the competitive gap audit), nested
  under the existing fingerprint-resistance toggle and off by default. Moat's canvas/audio/WebGL
  noise has always been deterministic per install, forever; Brave rotates its own noise per
  session specifically because a fingerprint that never changes can itself become a durable
  cross-site identifier. Rather than change that default for every existing user, this ships as a
  separate opt-in: when on, `src/content/bridge.ts` sources the noise seed from
  `browser.storage.session` (cleared on browser/extension restart) instead of the permanent
  per-install one. The background worker grants content scripts access to session storage once at
  startup (`storage.session.setAccessLevel`); a page load that races that call falls back to the
  permanent seed rather than failing.
- **`docs/research/competitive-gap-audit.md`** updated with a status line on every ranked item —
  done/pending/declined, with the reasoning, closing the loop on the audit's own open questions.

## 0.11.14

### Added
- **Emergency "quick-fix" filter channel** (item e of the competitive gap audit), AdGuard's
  "Quick Fixes filter" pattern applied to Moat's existing daily live-update pipeline instead of
  new infrastructure. `src/background/liveUpdates.ts` now also fetches `live/quick-fixes.json`
  on the same daily alarm and applies validated entries as dynamic `declarativeNetRequest` rules
  (`src/background/quickFixRules.ts`, id range 950,000-950,499 -- clear of the existing custom-rule
  and live-redirect ranges). An entry can only block, allow, or strip query params; there's no
  `action.redirect.url`/`regexSubstitution` shape, so a compromised feed can't be used to redirect
  traffic anywhere. Empty by default -- this is the channel, not an active patch. Settings' live
  status line only mentions it when a fix is actually active.

## 0.11.13

### Added
- **Click-through company detail in the popup's "By company" list.** Each row now expands, on
  click, to a short description, category, and website link sourced from Ghostery's TrackerDB --
  the same data source already used for the company attribution itself, just more of it. A new
  build-time output, `rules/company-info.json` (deduped to only the ~1,380 companies actually
  attributed to a shipped rule, not TrackerDB's full ~2,600-organization catalog), is fetched
  lazily on first click rather than bundled into every popup open.
- **A plain-language summary line** above the Ads/Trackers/Popups breakdown ("Nothing to block on
  this page" / "A few trackers blocked" / "Heavily tracked page"), bucketed from the same real
  block count already shown in the hero number -- not a fabricated site-safety grade, since Moat
  has no independent data on the site itself to grade, unlike DuckDuckGo's letter-grade feature
  this was inspired by.

  **Reverted in v0.11.16** -- see above.

## 0.11.12

### Added
- **Closed the material gaps found in the ClearURLs comparison** (`docs/research/clearurls-gap-audit.md`,
  Finding 3): a new first-party ruleset (`ruleset_url-tracking-extra.json`, generated in
  `scripts/update-filters.mjs` alongside the existing GPC rule so it survives `filters:update`
  reruns) strips tracking params AdGuard's bundled URL Tracking filter misses on google.com search
  results, facebook.com, amazon.*, bing.com, twitter.com/x.com, reddit.com, twitch.tv, and
  youtube.com. Google's `ie` and `dpr` are deliberately left out -- not obviously tracking-only by
  name alone, per the audit's own caveat.

### Fixed
- **`npm run filters:update` was broken** -- `@adguard/dnr-rulesets` moved its rulesets from
  `dist/filters/declarative/` to `dist/filters/chromium-mv3/declarative/` in a recent release
  (still within this project's `^4.0.x` semver range), so every ruleset regeneration since
  v0.11.11 was silently impossible. `scripts/update-filters.mjs`'s source path now matches.

## 0.11.11

### Added
- **Leaked-password check, off by default.** A new "Check passwords against known breaches"
  toggle (Advanced Protection) warns -- via a small, non-blocking inline tooltip -- when a
  password you type into a page has appeared in a known data breach. Uses HaveIBeenPwned's
  Pwned Passwords k-anonymity API: only a 5-character SHA-1 hash prefix ever leaves your
  device, never the password or its full hash. Off by default, since (unlike every other
  toggle in this section) it involves a network request derived from what you typed --
  toggling it on is a deliberate trust decision, not a free privacy win. Top-frame only, so
  a cross-origin login iframe isn't covered. Never blocks or clears the field either way.

## 0.11.10

### Added
- **i18n migration: options page.** All user-facing strings in `options.html`/`options.ts`
  (73 static `data-i18n`/`data-i18n-placeholder` keys, 21 dynamic `browser.i18n.getMessage()`
  call sites -- presets, category labels, live-status text, rule counts, import/export
  status, the version string) now route through `_locales/en/messages.json`. A handful of
  About-tab paragraphs that mix plain text with an inline link/emphasis are deliberately left
  as English-only static markup -- `applyStaticI18n` replaces an element's whole `textContent`,
  which would silently delete an embedded `<a>`/`<strong>`/`<code>`; documented in place with
  an HTML comment rather than risked. No behavior or visual change otherwise. This completes
  the i18n infrastructure work (0.11.8-0.11.10) -- English-only for now, no translations yet.

## 0.11.9

### Added
- **i18n migration: popup.** All user-facing strings in `popup.html`/`popup.ts` (~16 keys)
  now route through `_locales/en/messages.json` via `data-i18n` attributes (static markup)
  or `browser.i18n.getMessage()` (the "protected"/"paused" state text and the load-error
  fallback). English text stays in the HTML as a dev-readability fallback. No behavior or
  visual change -- infrastructure migration, not a new language yet.

## 0.11.8

### Added
- **i18n infrastructure (manifest/build plumbing).** `default_locale: "en"` +
  `src/_locales/en/messages.json`, `__MSG_extName__`/`__MSG_extDescription__` in the
  manifest, a new `scripts/build.mjs` copy step for `_locales/`, and a shared
  `applyStaticI18n`/`getMessageOrFallback` helper (`src/shared/i18n.ts`) for the popup/
  options migration that follows. English-only for now, no translations yet -- this is the
  prerequisite plumbing, not a feature on its own. `getMessage` returning `""` for an
  unresolved key would otherwise silently blank UI text during the migration; the fallback
  wrapper turns that into visible (kept) text instead.

## 0.11.7

### Added
- **A brief first-run card in the popup** introducing the per-site pause toggle and
  Settings, and **a small "what's new" link after an update**, pointing at the CHANGELOG.
  Both are "view = dismiss" -- shown once, gone on the next open, no explicit close button
  needed. Tracked under a new, separate `uiState` storage key, deliberately kept out of
  `Settings`/the export-import and sync payloads since neither flag is a user preference.

## 0.11.6

### Added
- **Opt-in settings sync via `storage.sync`** (new toggle in Backup & restore, off by
  default). Seeds a fresh install from an existing synced copy if one exists, then mirrors
  local changes going forward -- last-write-wins, no live cross-device merge, not a
  real-time sync engine. The per-install fingerprint-resistance identifier is never synced.
  A sync-quota failure (storage.sync caps at ~100KB total / ~8KB per item) fails silently,
  same posture as everything else here that stays invisible until turned on.

## 0.11.5

### Added
- **Settings export/import**, in a new "Backup & restore" section on the About tab. Download
  writes the current settings as JSON (excluding the per-install fingerprint-resistance
  identifier); Upload validates the file's shape field-by-field before applying anything --
  a malformed or unrelated JSON file is rejected outright rather than partially applied.
  Export always reads raw settings, never the managed-policy-merged view, so an
  organization's forced/locked values can never be captured as if they were the user's own
  preference and later "restored" as such on an unmanaged device.

## 0.11.4

### Added
- **A "Report a problem" button in the popup**, opening a pre-filled GitHub issue with the
  site's hostname (never the full URL, to avoid leaking tracking/session query params into
  a public issue) and the filter groups currently enabled globally. Uses only cross-browser,
  cheap data (`summarizeFilterLists`/`effectiveFilterGroupState`), not Chrome-only
  `getMatchedRules`, so it works identically on both browsers. Hidden on pages with no
  hostname (e.g. `chrome://` pages), matching the existing site-card behavior.

## 0.11.3

### Added
- **A keyboard shortcut (default Ctrl+Shift+M / Cmd+Shift+M) to toggle protection globally**,
  without needing to open the popup. Mentioned in the About tab along with the
  `chrome://extensions/shortcuts` rebind page. No extra visual feedback on toggle -- same as
  flipping the master switch by hand, consistent with the project's "no nag UI" stance.
- `short_name` and `homepage_url` manifest fields, closing two small gaps in the manifest
  metadata ahead of a Chrome Web Store listing.

## 0.11.2

### Added
- **Accessible names on every toggle switch, in both the popup and options pages.** Every
  switch (`<label class="switch">…`) wrapped only the visual track/thumb, leaving its
  descriptive text as a disconnected sibling -- a screen reader landed on each one and
  announced "checkbox, not checked" with no name at all. Added `id`s to the 8 static toggle
  titles in the Protection tab plus the per-site pause toggle in the popup, and
  `aria-labelledby` on each matching input; the dynamically generated per-filter-list
  toggles (`renderFilterLists` in `options.ts`) now get an id assigned at creation time too.

## 0.11.1

### Added
- **A `LICENSE` file (GPL-3.0) and `package.json`'s `license` field.** The project had no
  license anywhere for its own code -- only the README's Licensing note, which covered the
  bundled third-party filter/tracker/consent data, never Moat's own source. GPL-3.0 chosen to
  match the license already covering the bundled AdGuard/EasyList filter data, so the whole
  distributed package sits under one consistent license rather than mixing families.

## 0.11.0

Release-readiness pass, aimed at getting the extension into shape for a Chrome Web Store
submission: build performance, CI reliability, a real privacy policy, and a documented,
now-surfaced-in-the-UI gap in Chrome's rule-count budget.

### Changed
- **Content scripts and the background worker now ship minified.** `scripts/build.mjs` had
  `minify: false` hardcoded since the first build script -- every entry (background worker,
  9 content scripts, popup, options, logger) is injected on every matching page load, so
  shipping them unminified was pure dead weight. Minified only for real builds; `--watch`
  (dev) stays unminified so stack traces and breakpoints remain readable. Cuts total JS
  payload across all 12 entries from ~450KB to ~160KB.
- **`npm run filters:update`'s live network fetches now retry on transient failure.**
  `update-cosmetics.mjs` (7 fetches to filters.adtidy.org) and the two `scripts/vendor-*.mjs`
  scripts (via `scripts/lib/vendorFetch.mjs`, fetching from raw.githubusercontent.com) each
  made a single unretried `fetch()` call -- one dropped connection or transient 5xx/429 from
  either upstream failed the whole chain, which `.github/workflows/ci.yml` runs on every push
  and PR. New `scripts/lib/fetchWithRetry.mjs` retries network errors and 429/5xx responses
  (3 attempts, exponential backoff) before giving up; a real 4xx, or any error from the
  caller's own parsing/validation, still fails immediately since that's a real bug, not a
  transient blip.
- Reinstalled `node_modules` from the committed lockfile -- local `node_modules` had drifted
  to vite@8.2.2 against the lockfile's pinned 5.4.21 (likely a stray `npm install` outside the
  lockfile), which is what surfaced the missing-`esbuild`-package failure while enabling
  minification above. `npm ci` restores the pinned version; this wasn't a repo-tracked issue.
- Ran `npm audit fix` (non-breaking): resolved the axios (via `@adguard/dnr-rulesets`) and
  js-yaml (via `@adguard/scriptlets`) advisories. Two remaining advisories (esbuild via vite's
  dev server, image-size via web-ext's addons-linter) only have `--force` fixes that bump
  major versions already confirmed to break this project's build/lint scripts -- deferred
  rather than risked; both are dev-tooling-only and never ship in the built extension.

### Added
- **Test coverage tooling** (`@vitest/coverage-v8`, `npm run test:coverage`). No coverage gate
  added to CI yet -- the current ~33% statement coverage is mostly the browser-API entry
  points (background/index.ts, popup.ts, options.ts, content script bootstraps) that need a
  real browser to exercise meaningfully, versus the pure-logic modules underneath them
  (consent engine, cosmetic selectors, rule company lookup, etc.), which mostly sit at
  85-100%. Available as a real number now instead of a file-count impression.
- **A Filter Lists warning banner for when Chrome's shared DNR rule budget is exceeded.**
  Chrome guarantees only 30,000 enabled static rules per extension
  (`GUARANTEED_MINIMUM_STATIC_RULES`); Moat ships 274,186 across 18 rulesets, with anything
  beyond the guaranteed floor drawn from a pool shared across every extension installed in the
  browser. The background worker already detected and recorded when
  `declarativeNetRequest.updateEnabledRulesets()` failed for this reason (added in 0.10.0's
  audit pass, via `getFilterGroupStatus()`) but nothing in the UI ever read it -- the Filter
  Lists tab in Settings now shows a warning when that's happened, instead of toggles silently
  not taking effect. See the new Known Limitations entry in the README.
- **`PRIVACY.md`**, linked from the README's Permissions section and Contents. States plainly
  that Moat collects, stores, and transmits no user data, and discloses the two narrow
  exceptions where its own code talks to a network at all (the daily redirect-domain-list
  refresh, and Firefox-only opt-in CNAME-uncloak DNS resolution) -- required reading material
  for the Chrome Web Store's Privacy practices dashboard field before submission.

## 0.10.1

### Changed
- Implemented the four low-severity audit findings 0.10.0 deliberately left as-is (each had been
  judged not worth the churn at the project's actual scale, but doing them properly turned out to
  be reasonably contained):
  - `ruleLogger.ts`'s diagnostic per-tab match buffer is now a real fixed-capacity ring buffer
    (`push` is O(1); the old array + `shift()` was O(n) once full) instead of just being named
    one. `push` happens on every matched request; the O(n) cost of materializing an ordered
    snapshot now only happens on `getEntries()`, which is only called when the diagnostic logger
    page is actually open.
  - `options.ts`'s five removable lists (paused sites, custom block/allow, the picker's two
    saved-rule lists) now each re-render just themselves after an add/remove instead of the
    page-level `render()` tearing down and rebuilding every list plus the filter-groups
    checkboxes for a single-item change.
  - `build.mjs`'s 12 independent per-entry Rollup builds now run via `Promise.all` instead of
    one at a time -- each is a fully independent graph with no shared state.
  - `chunkBySize.mjs` now documents in a comment that its size check measures UTF-16 code units
    rather than bytes (a non-issue at these rules' effectively-ASCII content, but worth naming).

## 0.10.0

### Security
- **postMessage config messages between the isolated- and MAIN-world content scripts were
  spoofable by the page itself.** `mainWorldGuard.ts` and `fingerprintGuard.ts` trusted any
  `window.postMessage` shaped like `{source: "moat", ...}`, authenticated only by
  `event.source === window` -- true for the page's own scripts too. Any page could spoof a
  config message (e.g. `{disabled: true}`) with one line and silently switch off the
  popup/redirect guard or fingerprint resistance. `bridge.ts` now mints a random
  `crypto.randomUUID()` token once per page load and includes it on every config message; both
  guards lock onto the first token they see and ignore anything that doesn't match it after
  that. This doesn't make it unspoofable -- same-window `postMessage` can always be observed
  once sent -- but raises the bar from zero-effort to "must eavesdrop the real message first."

### Fixed
- **Two rapid settings writes could silently clobber each other.** `settings.ts`'s
  `addSelectorRule`/`removeSelectorRule`/`getOrCreateFingerprintSeed`/`setSiteDisabled` each did
  an unserialized read-modify-write; two concurrent calls (two fast element picks, a toggle flip
  mid-save) could both read the same stale snapshot and the second write would drop the first's
  change. All settings mutations now funnel through one module-level FIFO queue. The same race
  existed in `options.ts`'s filter-list checkbox handler (each read `getSettings()` fresh instead
  of reusing `render()`'s already-fetched snapshot) and in the live redirect-domain refresh and
  custom-rule domain lists, which had no validation at all -- a single malformed entry (a pasted
  full URL, a stray space) threw and silently dropped the entire batch of dynamic rules, not just
  the bad one. All three now validate/serialize independently.
- **`applyPrivacySettings` never actually relinquished control of a toggle once touched.**
  Chrome's `.set({value: "default"})` still marks a privacy setting "controlled by this
  extension," unlike `.clear()` -- contradicted the file's own comment that these settings "only
  take effect once the user explicitly flips them on." Now clears instead of setting the default
  when a toggle is off.
- **A consent banner's "manage partners"-style link silently fought `mainWorldGuard.ts`'s own
  popunder blocker.** `consent/actions.ts`'s `openInTab` action dispatched a synthetic ctrl-click
  to simulate a new-tab open; a `target="_blank"` anchor made that indistinguishable from the
  exact ad-popunder pattern `mainWorldGuard.ts` blocks. Now calls `window.open()` directly.
  Separately, `feedAdLabel.ts`'s label normalizer had `.replace(/ /g, " ")` -- a literal no-op,
  almost certainly meant to collapse non-breaking spaces (` `) that some platforms embed in
  short labels like "Paid partnership," which silently defeated the exact-match sponsored-post
  detector.
- **Settings changes didn't reach already-open tabs.** `feedAdScanner.ts`, `youtubeAdDimmer.ts`,
  and `consentRejector.ts` each read their enabled-toggle once at content-script startup with no
  `storage.onChanged` listener -- turning a setting off did nothing on an already-open tab until
  reload. All three now react live, matching the pattern `bridge.ts`/`cosmeticFilter.ts` already
  used.
- **A corrupted or missing `rules/manifest.json` took down the whole options page.**
  `loadRulesetManifest`'s fetch/parse had no error handling; a failure threw partway through
  `render()` and silently aborted every section after it (custom lists, version text, the
  managed-policy notice). Now renders a visible "Couldn't load filter lists" state and lets the
  rest of the page render independently.
- **`youtubeAdDimmer.ts`'s player-wait observer never gave up.** Most YouTube pages (search,
  channel, home) never have a `#movie_player` at all; the fallback `MutationObserver` watching
  all of `document.body` ran for the tab's entire lifetime regardless, on one of the web's most
  mutation-heavy SPAs. Now disconnects after 15 seconds if no player ever appears.
- **The live redirect-domain safety net only ever grew, never shrank.**
  `popupGuard.ts`'s `addLiveRedirectDomains` merged each day's refresh into a `Set` that was
  never reset -- a domain removed upstream (a fixed false positive) stayed blocked locally until
  the worker restarted. The daily refresh fetches the full current list each time, not a diff, so
  this now replaces the live slice instead of merging into it, while keeping the bundled baseline
  separate and permanent.
- **`filterGroups.ts` swallowed `updateEnabledRulesets` failures entirely.** Hitting Chrome's
  enabled-ruleset budget (or a stale cached manifest) left the Options UI showing a toggle as
  changed with no indication it hadn't actually applied. Now records an ok/timestamp status the
  options page can surface, mirroring the existing live-update status pattern.
- Background message handling (`index.ts`) now validates incoming runtime messages have a shape
  before switching on `.type`, and validates `hostname`/`selector` string fields independently at
  that boundary instead of trusting the sender's shape unconditionally.
- `cnameUncloak.ts` no longer caches a failed DNS resolution forever -- a single transient
  lookup failure used to permanently disable uncloak-checking for that hostname until the
  background context restarted; failures are retried on the next request instead, and the
  positive-result cache is now capped rather than unbounded.
- `liveUpdates.ts` now validates the fetched redirect-domain list is actually an array of
  hostnames before applying it, instead of trusting the remote JSON's shape unconditionally.

### Changed
- `filterGroups.ts` and `matchStats.ts` each fetched and cached their own separate copy of
  `rules/manifest.json` in the same background worker -- factored into one shared loader.
  Similarly, `matchStats.ts`/`badge.ts`'s identical per-tab-map "reset"/"forget" function pairs
  now share one implementation each instead of two independently-maintained copies.
- `options.ts`'s three near-identical "clear list, sort, build `<li>` rows with a remove button"
  helpers are now one shared `renderRows` generic, also used by the two custom block/allow lists.
  `popup.html`'s hardcoded button colors now reference `theme.css`'s `--on`/`--danger` tokens
  instead of repeating literal hex values that could silently drift from the shared palette.
- `isPlausibleTrigger.ts`'s popunder heuristic now also catches `visibility: hidden` and
  clip-collapsed elements, not just near-zero opacity.
- `consent/engine.ts`'s CMP list is now built once per page load and reused across every
  `consentRejector.ts` retry attempt (up to 8 seconds of polling), instead of rebuilding all
  ~100+ CMP entries from scratch on every attempt; `Cmp` similarly runs its detector-matching
  scan once per check instead of twice (`isPresent` + `isShowing` back to back).
- `scripts/manifest.ts` reads its `version` field from `package.json` instead of a hand-copied
  literal, which had already drifted stale for a full release cycle once before. `build.mjs`'s
  `dist/` cleanup now prints a clear message when the directory is locked by another process
  (an editor, a stray preview server, the browser with the unpacked extension loaded) instead of
  a raw Node EPERM stack trace. `vendor-consent-rules.mjs` now fails the build loudly if
  Consent-O-Matic's upstream rules ever reference an action type the interpreter doesn't
  recognize, instead of silently shipping unvalidated surface to the runtime engine.
  `update-cosmetics.mjs` now asserts a byte-size floor on each fetched filter list and logs a
  diff against the previously-committed selector counts. `validate-rules.mjs` now checks
  `action.type` against DNR's actual legal enum. `filters:update` now chains `validate:rules`
  instead of requiring a maintainer to remember to run it separately. `vendor-cname-list.mjs` and
  `vendor-consent-rules.mjs`'s near-identical fetch/validate/write logic is now a shared
  `fetchAndVendor` helper in `scripts/lib/`.
- Managed-policy documentation (`managedPolicyMerge.ts`, `managed_schema.json`) now spells out
  that `lockProtectionToggle` alone only locks the UI toggle -- `forceEnabled` must also be set
  for an admin policy to actually force protection back on for a user who'd already disabled it.

### Removed
- **`scripts/generate-icons.mjs`.** Dead code: not referenced by any `package.json` script,
  untouched since the project's first commit, and rendered the pre-redesign color scheme --
  actively misleading rather than just unused, since running it would have silently overwritten
  the real icons with a stale, wrong design.
- `theme.css`'s unused `button.danger` rule, which never actually painted anywhere (popup.html's
  own higher-specificity local override always won the cascade).

This release is the result of a full-codebase audit for correctness, security, complexity, and
dead code across every area -- content scripts, the background worker, the UI, and the build
pipeline. A few low-severity findings were deliberately left as-is, each because the audit's own
assessment was that fixing them wasn't worth the churn at the project's actual scale: `ruleLogger.ts`'s
dev-mode-only diagnostic buffer is described as a "ring buffer" but implemented with
`push`/`shift` (O(n) once full, inconsequential at 200 entries); `options.ts`'s `render()` does a
full teardown/rebuild of every list on any single mutation (harmless at realistic scale of tens of
entries); `build.mjs` runs its 12 Rollup builds sequentially instead of via `Promise.all` (keeps
build output deterministic, a judgment call rather than a defect); and `chunkBySize.mjs` measures
selector size in UTF-16 code units rather than bytes (a non-issue at these rules' effectively-ASCII
content).

## 0.9.2

### Fixed
- **"Block an element..." silently did nothing on tabs opened before the extension was last
  loaded/reloaded.** `element-picker.js` is a `document_idle` content script, which only
  auto-injects as pages load -- a tab left open from before an install/reload has no listener,
  so `popup.ts`'s `browser.tabs.sendMessage` had nowhere to go and failed silently.
  `src/popup/popup.ts` now falls back to `browser.scripting.executeScript` to inject the content
  script on demand and retries once if the first send fails. Added the `scripting` permission
  (`scripts/manifest.ts`) for this. `manifest.ts`'s own hardcoded `version` field had also drifted
  out of sync with `package.json` since 0.9.0 -- brought back in line and will be checked at each
  future bump.

### Changed
- **Options page and element-picker dialog now match the popup's redesign.** Both were still on
  the pre-redesign palette, which read as two different products. `src/ui/theme.css`'s shared
  `--accent` token drops the blue in favor of a greyish-white (`#d7dae0`) pulled from
  `icons/logo.svg`'s own line/dot colors -- affects `options.html` only (links, row icons, hover
  borders), since `popup.html` already hardcodes its own colors independently. Added an `--on`
  token (`#4ae03f`) so the toggle-checked and primary-button green stays a distinct affirmative
  color from the link/icon accent, matching the popup's toggle. The element-picker's floating
  panel (`src/content/elementPicker.ts`) -- the "Hide on this site / Hide for now / Gray out /
  Cancel" dialog that appears after clicking an element -- moves off its old hardcoded teal/orange
  palette onto the same dark/green/coral system, with pill-shaped buttons to match.
- **Rewrote all options.html copy.** Full pass on every card title, hint, empty state, and button
  label, plus new group headings ("Advanced Protection", "Filter Updates", "Cosmetic Filtering")
  above related cards. "Paused sites" is now "Exceptions"; "Grayed-out elements" is now "Dimmed
  elements". `options.ts`'s `PRESET_HINTS.standard` string updated to match so the "Filtering
  level" hint doesn't flash old text before the new copy loads.

## 0.9.1

### Changed
- **Redesigned the popup.** Explored ten real ad-blocker visual languages (uBlock Origin,
  AdGuard, Brave Shields, Ghostery, Privacy Badger, AdBlock Plus, 1Blocker, Wipr,
  Malwarebytes, DuckDuckGo) side by side, rebuilt with Moat's own content so they were
  directly comparable, then picked and iterated on one. `src/popup/popup.html` moves to a
  dark-to-gray gradient body, a centered hero stat card, pill-shaped Ads/Trackers/Popups
  chips, a white site card with a blue "protected" state and a green toggle, and a coral
  pill-shaped "Block an element..." button. Settings moved into the header row. The header
  mark is the existing `icons/logo.svg` constellation, inlined -- no new icon, no ghost or
  other borrowed mascot. Deliberately did not adopt the reference direction's Google Font
  (`Baloo 2`): a privacy tool that avoids external network calls by design shouldn't add one
  for its own popup chrome, so the rounded/friendly feel comes from weight and radius on the
  existing system font stack instead. No changes to `popup.ts` -- all element ids/classes it
  depends on are unchanged, this is a markup/CSS-only pass.

## 0.9.0

### Added
- **Uncloak disguised trackers (Firefox only, off by default).** A CNAME-cloaked tracker hides
  behind a subdomain of the site you're on (e.g. `trk.example.com`) that secretly resolves
  elsewhere via DNS, specifically to defeat domain-based blocking -- the 274,000 static rules
  never see the real destination. Chrome has no DNS-resolution API for extensions at all,
  confirmed as a hard platform gap (no workaround exists, not a missing permission). Firefox
  exposes `dns.resolve()`, the same API uBlock Origin uses there. `src/background/cnameUncloak.ts`
  adds a blocking `webRequest.onBeforeRequest` listener (Firefox still allows this under MV3;
  Chrome no longer does) that resolves the real canonical name for candidate requests and cancels
  them if it leads into a known tracker destination
  (`rules/dnr/cname-cloak-destinations.json`, vendored from
  [NextDNS's public list](https://github.com/nextdns/cname-cloaking-blocklist), MIT-licensed).
  Firefox's blocking listeners support returning a `Promise` (since Firefox 52), so this resolves
  DNS directly in the listener per candidate request rather than needing a separate cache-warming
  pass with a fail-open compromise.
- Scoped to actual candidate requests only: a subresource is only checked if its hostname shares
  the current page's own domain apex (`cnameUncloakMatch.ts`'s `isCandidateForUncloak`, tested) --
  that's the entire cloaking technique, so a request to a domain that doesn't share the page's
  apex is already visible to and blockable by the static rules directly and skips the DNS lookup
  entirely. Own in-memory cache on top of Firefox's own DNS cache to avoid redundant resolves
  within a session.
- Design correction during implementation: the original plan considered a static-list-only
  approach (no live DNS resolution) as lower-risk. Checking NextDNS's own README first showed
  that's a non-starter -- their list only works "wildcard matched against CNAMEs," which requires
  actually resolving the chain; a static list alone has nothing to compare a disguised hostname
  against. Corrected to real resolution before writing any code, scoped to Firefox only where an
  API for it actually exists.

## 0.8.0

### Added
- **Auto-reject cookie banners** (Settings → Protection, off by default). Cosmetic filtering
  already hides banners that match a plain selector, but the "click reject for me" half was a
  known gap -- AdGuard's own Cookie Notices list mostly handles that via scriptlets, arbitrary
  injected JS Moat deliberately never executes. `src/content/consent/` is a from-scratch
  interpreter for [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)'s declarative
  rule format (MIT-licensed) instead: inert JSON describing which selector to click, the same
  trust boundary as Moat's own cosmetic selectors, not a scriptlet engine. Ported by hand from
  their actual source (`Tools.js`/`Matcher.js`/`Action.js`/`CMP.js`/`ConsentEngine.js`), not
  guessed from the schema alone -- caught two real schema-vs-implementation mismatches doing
  that (a `styleFilter` field the shipped code never actually reads; `DOMSelection`'s nominally
  recursive shape only ever resolved one level deep in practice) and matched what the extension
  actually does today.
- Supports the full action/matcher vocabulary needed for correct default-reject behavior,
  including the checkbox/consent-matrix system (IAB-style category codes) most major CMPs
  require to reach a real "reject all" rather than just clicking whatever's labeled "Decline" --
  every category defaults to reject (`consent/types.ts`'s `REJECT_ALL`), Consent-O-Matic's own
  out-of-the-box default too, not a stricter policy invented here. Vendors a few dozen of the
  most widely-reused consent platforms (OneTrust, Cookiebot, Didomi, Quantcast, TrustArc,
  Sourcepoint, and others -- `rules/dnr/consent-rules.json`, `scripts/vendor-consent-rules.mjs`),
  not Consent-O-Matic's separate 200+ per-site bespoke rule catalog.
- Deliberately narrower than upstream in a few places, each with its reasoning in
  `src/content/consent/`'s file headers: no drag-simulated consent sliders; `close` is a safe
  no-op rather than `window.close()` (this only ever runs in the page's own tab, where closing
  the window would close the user's actual browser tab); no progress-dialog/PIP visual chrome,
  since Moat has nowhere it would show; `CheckboxMatcher`/`OnOffMatcher` fail safe (report "not
  enabled") rather than throw when their target can't be resolved, so one missing element on a
  slightly different page variant can't abort a whole method.
- **Verified end-to-end against real, currently-vendored rule content, not just unit tests of
  the interpreter in isolation**: `consent/engine.test.ts` runs the actual Cookiebot and
  OneTrust rules (frozen fixtures, pasted from the live source) against simulated realistic
  banner markup and confirms the default-reject path clicks only "Decline"/unchecks pre-checked
  categories -- never "Accept" -- for both the direct-checkbox (Cookiebot) and parent-scoped
  category-panel (OneTrust, the single highest-market-share CMP) patterns. 63 new tests total
  across `consent/tools.test.ts`, `matchers.test.ts`, `actions.test.ts`, `cmp.test.ts`, and
  `engine.test.ts`.
- Design note: the original plan considered a smaller "simple tier only" interpreter (click/
  hide/wait/ifcss/waitcss, skipping the checkbox-matrix system entirely) to avoid the larger
  implementation surface. Investigating Cookiebot's actual `SAVE_CONSENT` rule showed why that
  would have been wrong, not just less capable: on CMPs with a "levels" consent UI, the button
  that commits the user's selection is often literally labeled "Accept" -- correct only because
  `DO_CONSENT` (the checkbox-matrix step) already zeroed out every category first. A simple-tier
  interpreter would have needed to either skip those sites entirely or risk clicking that
  "Accept"-labeled commit button without ever having unchecked anything -- confirming the fuller
  implementation was the safer choice, not just the more thorough one.

## 0.7.8

### Added
- **Idle-time trim for unmatched generic cosmetic selectors.** The ~17k generic (no-hostname)
  selectors were being injected into a `<style>` block and kept live for the rest of the page's
  life whether or not anything on the page actually matched them. `cosmeticFilter.ts` now splits
  injection into two `<style>` blocks -- one for per-domain/custom selectors (unchanged, never
  trimmed), one for generic selectors -- and, once on the `window` `load` event (not a
  MutationObserver, not per-mutation), checks which generic selectors still match anything via
  the new `selectorsStillMatching` (`src/content/cosmeticSelectors.ts`, tested against real jsdom
  DOM matching) and rebuilds that block's text from just the survivors. `document_start`
  injection itself is untouched -- same CSS, same timing, zero added FOUC risk -- so this is a
  style-engine cleanup (fewer live selectors for the browser to keep evaluating on every later
  recalc, most relevant on long-lived SPA tabs like Instagram/YouTube/LinkedIn), not a network
  optimization: the full generic set is still fetched and injected upfront exactly as before.
  Deliberately rebuilds from the already-known selector array rather than parsing pruned
  selectors back out of the CSSOM's rendered `selectorText` -- some kept selectors (native
  `:has(a, b)`) contain commas of their own that a naive text re-split would have corrupted.
  `selectorsForHostname` is now composed from two new exported halves,
  `genericSelectorsForHostname`/`domainSelectorsForHostname`, each independently tested; existing
  behavior and its existing tests are unchanged.

## 0.7.7

### Added
- **Rule-match logger, a development tool.** `src/logger/logger.html` (linked from Settings →
  About → Debugging) lists every request `declarativeNetRequest.onRuleMatchedDebug` saw on the
  active tab and which of Moat's compiled rules matched it -- built to help diagnose the
  already-flagged fragile heuristics (the YouTube ad dimmer, the feed scanner) when they break
  silently after a site markup change, instead of guessing. Deliberately scoped as a diagnostic
  tool, not a general feature: Chrome only fires that event for extensions loaded unpacked
  (developer mode), never a Web Store install, and Firefox doesn't implement it at all --
  `src/background/ruleLogger.ts` feature-detects it and keeps an in-memory, per-tab ring buffer
  (last 200 matches, evicted oldest-first -- tested via the pulled-out pure `appendEntry`), not
  persisted to storage. The page itself shows a clear "not available" message rather than an
  empty table when unsupported.

## 0.7.6

### Added
- **Optional "By company" breakdown in the popup.** The existing Ads/Trackers/Popups strip now
  has a collapsed-by-default `<details>` disclosure underneath it attributing as many blocked
  requests as possible to the actual organization behind them (Google, Amazon, Criteo, etc.),
  purely informational -- no new decision asked of anyone, and it's hidden entirely when nothing
  is attributed. Attribution happens at filter-update time, not at runtime: a new pure module,
  `scripts/lib/ruleCompany.mjs` (tested, including a cross-check against the existing
  `src/shared/domainChain.ts` runtime copy), extracts each compiled rule's target domain from its
  `urlFilter` and looks it up against Ghostery's TrackerDB (`@ghostery/trackerdb`'s bundled
  `dist/trackerdb.json`, CC-BY-NC-SA-4.0 -- confirmed compatible with Moat's non-commercial
  status), walking the domain chain so a subdomain still resolves via its registrable parent. The
  result is written to `rules/dnr/rule-companies.json`, keyed by `rulesetId` then `ruleId` to
  avoid collisions across chunked rulesets (DNR rule ids are only unique per-ruleset). At
  runtime, `getMatchedRules()`'s previously-discarded `ruleId` field (see
  `src/background/matchStats.ts`) is now kept and joined against this map by a new pure module,
  `src/shared/matchedRuleCompanies.ts` (tested).
- **Caught and fixed a real correctness bug before shipping this**: naively correlating every
  ruleset would have attributed thousands of malicious/phishing-URL blocks to "GitHub, Inc." and
  "Weebly" -- those rulesets block arbitrary bad content parked on free hosting platforms by
  domain, and domain-chain-walking up to the platform's own registrable domain (`github.io`,
  `weebly.com`) falsely credited the platform itself as the tracker. Verified live against the
  actual generated data (6,303 and 4,344 rules respectively) before restricting attribution to
  ad/tracking rulesets only, where the blocked domain genuinely is the tracker's own
  infrastructure -- 11,635 rules attributed after the fix, none of them security-list false
  positives.

## 0.7.5

### Added
- **Stopped dropping ~990 `$redirect` filter rules.** These rules neutralize ad scripts by
  redirecting them to a bundled no-op resource (`nooptext.js`, `1x1-transparent.gif`,
  `click2load.html`, etc.) instead of a plain block, but we didn't ship the resource files
  those rules point at, so `scripts/update-filters.mjs` silently dropped the whole slice.
  `@adguard/scriptlets` -- already a transitive dependency of `@adguard/dnr-rulesets` -- ships
  exactly the resource files AdGuard's own rules reference: a new pure helper,
  `resolveRedirectResource` (`scripts/lib/redirectResources.mjs`, tested), resolves each rule's
  `extensionPath` against what's actually available and only drops a rule if its specific
  resource genuinely isn't shipped (confirmed live against the current rule set: 0 of the 30
  referenced files are missing). The needed resource files are vendored into
  `rules/redirect-resources/` at filter-update time, copied into
  `web-accessible-resources/redirects/` at build time, and declared in the manifest's new
  `web_accessible_resources` entry -- no rule rewriting needed, the paths AdGuard's rules
  already encode just resolve now. Recovered rule count verified via `npm run validate:rules`:
  274,186 total rules, up from ~273,000.

## 0.7.4

### Changed
- **Cosmetic filtering fetches ~85% less data per page load.** `cosmeticFilter.ts` used to fetch
  and parse the *entire* per-domain selector index -- every domain's rules, for every site --
  before checking whether any of it even applied to the current page, because the files were
  split purely by size (`chunkBySize`), not by relevance. That was ~5.3MB of JSON on `<all_urls>`
  at `document_start`, on every single navigation. Replaced with domain-hash bucketing
  (`bucketForDomain` in `src/shared/domainBucket.ts`, mirrored in `scripts/lib/domainBucket.mjs`
  for the build script -- cross-checked by `scripts/lib/domainBucket.test.mjs` so the two copies
  can't silently drift): each domain is assigned to one of 64 shard files by a hash of its name,
  and the content script now only fetches the 1-3 buckets its own domain chain hashes into.
  Verified live (real `fetch()` calls against a served build, not just unit tests): youtube.com
  now pulls ~700KB across 3 files instead of ~5.8MB across all 66, and still resolves the correct,
  YouTube-only selectors -- nothing got lost or misrouted in the split.

## 0.7.3

### Removed
- **Dead message type.** `SetEnabledMessage`/`case "set-enabled"` in the background worker had no
  sender anywhere in the codebase -- options.ts calls `setSettings()` directly (it's a privileged
  page, no message-passing needed), so this was leftover from an earlier design. Removed.
- Un-exported six internal-only types/constants (`LiveUpdateStatus`, `AD_CONTAINER_SELECTOR`,
  `PresetDefinition`, `BreakdownBucket`, `MatchedRuleRef`, `FilterListSummary`) that were never
  imported by name outside their own module -- structurally still used internally, just tightened
  each module's actual public surface to what's really consumed elsewhere.

## 0.7.2

### Fixed
- **LinkedIn's real container wasn't `[data-urn]` or `.feed-shared-update-v2`.** Verified live
  against an actual "Promoted" post: neither matched. The real current wrapper is
  `[role="listitem"]` -- added as the primary LinkedIn container selector; the other two stay as
  harmless fallbacks in case an older LinkedIn layout still uses them.

## 0.7.1

### Fixed
- **LinkedIn was never actually in scope for the feed scanner** -- the content script's `matches`
  only covered Instagram and YouTube, so it silently did nothing there. Added
  `*://www.linkedin.com/*`, plus `"promoted"` (LinkedIn's actual label) to the recognized set, and
  `[data-urn]`/`.feed-shared-update-v2` as LinkedIn container selectors (`[data-urn]` is the more
  reliable of the two -- LinkedIn has migrated most of its class names to hashed CSS modules, the
  same pattern that already defeats fixed selectors on Instagram).
- **The exact-text match was too strict for Instagram specifically.** Feeds render the label
  sharing one text node with adjacent metadata -- e.g. a post header renders as one node reading
  "Sponsored · 2h", the same way an organic post's is "username · 2h". `isAdLabel` now splits on
  the separators these sites actually use (`•`, `·`, `|`, " - ") and checks each segment on its
  own, still an exact match per segment -- so this closes the gap without turning into a
  substring test that could start matching prose.

## 0.7.0

### Added
- **Aggressive feed ad removal** (Settings → Protection, off by default) -- a persistent scanner
  for Instagram and YouTube that watches feeds as you scroll and removes any post/card labeled
  "Sponsored," "Ad," or "Paid partnership" the instant it renders, instead of relying on a fixed
  selector. This exists because infinite-scroll feeds render sponsored content with class names
  that are often randomized per session specifically to defeat static filter-list rules -- a
  MutationObserver-driven text-label match (`src/content/feedAdScanner.ts`,
  `src/content/feedAdLabel.ts`) doesn't depend on any particular class name surviving. Off by
  default since a label match, unlike a fixed selector, carries a small false-positive risk (the
  match is an exact, trimmed, case-insensitive check against a whole text node, not a substring,
  specifically to keep that risk low).

## 0.6.1

### Changed
- **YouTube ad dimming is on by default now**, not opt-in. Verified live against a real ad on a
  news livestream (2026-08-23): confirmed `getMatchedRules`-independent detection via
  `#movie_player`'s own `ad-showing` class fired correctly, and the video's computed style came
  back `filter: grayscale(1)` as expected. Detection is now also more resilient: it checks
  `.ytp-ad-module` having content as a second, independent signal alongside the player's own
  ad-state class, so a future change to either alone won't silently disable it.
- **YouTube's sidebar/in-feed "Sponsored" cards are now hidden outright**, not just the in-stream
  video ads. Found live testing: a real sponsored card (`ytd-ad-slot-renderer` /
  `ytd-in-feed-ad-layout-renderer`) was rendering fully visible next to the video list, unmatched
  by AdGuard's bundled selectors. Added as first-party additions in `update-cosmetics.mjs`
  (`OWN_DOMAIN_SELECTORS`) rather than waiting on upstream -- these are static cards, so hiding
  them outright is safe, unlike the in-stream ads that need the grayscale treatment instead.

## 0.6.0

### Added
- **Gray out unblockable video ads** (Settings → Protection, off by default) -- dims in-stream
  video ads on YouTube instead of leaving them at full color. They play through the same `<video>`
  element as real content, so they can't be network-blocked or hidden without breaking the player;
  this watches the same `ad-showing`/`ad-interrupting` class YouTube's own player already toggles
  and applies `filter: grayscale(1)` while it's present (`src/content/youtubeAdDimmer.ts`). It's a
  first-party DOM observation, not a third-party script -- and it's a heuristic tied to YouTube's
  current markup, not a guarantee, so it's opt-in.
- **"Gray out" mode in the element picker** -- alongside "Hide on this site" and "Hide for now",
  the picker now has a third option that dims an element instead of removing it, for anything
  where hiding would break the page's layout. Saved picks are listed and removable under Custom
  Rules → Grayed-out elements, the same way hidden picks already were.

## 0.5.0

### Added
- **Real ads/trackers/popups breakdown in the popup.** Backed by declarativeNetRequest's own
  match-feedback API (`getMatchedRules`, gated behind the new `declarativeNetRequestFeedback`
  permission), refreshed once per page load and mapped from the 11 bundled filter-list groups
  to three buckets. Counts start at zero on a fresh page and fill in as the page's requests are
  actually matched -- nothing here is estimated. Chrome-only: Firefox hasn't implemented
  `getMatchedRules` yet, so the breakdown stays at zero there (`web-ext lint` flags this as an
  expected, benign `UNSUPPORTED_API` warning); the existing popup/redirect firewall count still
  works on both browsers and folds into the "Popups" bucket.

### Changed
- **Transparent icon.** Dropped the solid background square from the logo mark -- toolbar icon,
  store listing, and the options-page header now show just the mark. The source SVG lives at
  `icons/logo.svg`.
- **Popup site card** drops the "Protection on {site}" phrasing in favor of the hostname as the
  primary line, with "protected"/"paused" underneath it next to the toggle.
- **Options page visual pass**: cards now sit on a distinct background instead of just a border,
  the tab switcher is a segmented control instead of underlined tabs, and section headers got a
  consistent title treatment.

## 0.4.0

### Changed
- **Renamed to Moat.** New icon set (toolbar, store listing, options page) generated from a real
  logo mark, replacing the placeholder icons. The GitHub repo moved to
  `github.com/Samuelabhinav37/moat`; the About tab's links and the live redirect-domain fetch URL
  were updated to match.
- **Popup redesign** — the toolbar popup now leads with the logo and a single hero stat ("Blocked
  on this page") instead of a bare label-over-number card, and shows an explicit paused state:
  when protection is off for the current site, the popup swaps in a banner and a "Reload page"
  button instead of silently leaving stale counts on screen. "Block an element…" is now styled as
  a danger action (reusing the same accent the element picker highlights with) rather than a
  plain button, so its color matches what it actually does.
- Rewrote the About tab's copy to drop the dash-heavy phrasing in favor of plainer, shorter
  sentences.

## 0.3.0

### Added
- **Element picker** — "Block an element…" in the toolbar popup: hover and click anything on a
  page, then choose "Hide on this site" (saved, reapplied on future visits) or "Hide for now"
  (applies immediately, nothing saved) — the same two behaviors as uBlock Origin's separate
  Element Picker and Element Zapper tools, combined into one flow. Saved picks are listed and
  removable under Custom Rules → Hidden elements.

## 0.2.0

### Added
- **Filter Lists tab** — a filtering-level preset picker (Off / Essential / Standard / Strict)
  plus individual on/off switches for each of the 11 bundled filter lists, applied instantly at
  runtime via `declarativeNetRequest.updateEnabledRulesets` (no rebuild or reinstall needed).
- **Custom Rules tab** — user-added block list and allow list (exceptions), applied as dynamic
  `declarativeNetRequest` rules.
- **Enterprise-managed policy** — an admin can push settings via Chrome's `ExtensionSettings`
  policy or Firefox's `policies.json` (`managed_schema.json`), including forcing protection on,
  locking the filter-list toggles, and adding an org-wide blocklist. Locked controls show a
  "Managed by your organization" badge in Settings.
- **About tab** — privacy policy, version, links to this changelog and the source repo.
- Settings restructured into tabs (Protection / Filter Lists / Custom Rules / About).

## 0.1.0

Initial release.

- `declarativeNetRequest` rulesets from 11 AdGuard filter lists (ads, trackers, security/
  phishing/malware, social/annoyance), refreshed via `@adguard/dnr-rulesets`.
- Popup/redirect firewall: a MAIN-world content script guards `window.open` and synthetic clicks
  against hijacked popups/redirects, backed by a background tab safety net.
- Cosmetic filtering (element hiding) for leftover ad containers and cookie banners.
- Global Privacy Control header + `navigator.globalPrivacyControl`.
- Opt-in browser-wide privacy toggles (third-party cookies, WebRTC leak protection) and opt-in
  fingerprint resistance (canvas/audio/WebGL noise, navigator property bucketing).
- Live daily refresh of the known popup/redirect domain list from a tracked file in this repo,
  without waiting on a new store release.
- Per-site pause, master switch, no nag UI. Chrome and Firefox builds from one codebase.

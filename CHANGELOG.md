# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

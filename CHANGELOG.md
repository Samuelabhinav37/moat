# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

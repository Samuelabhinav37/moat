# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

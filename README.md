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

No nag screens, no "rate us" prompts, no onboarding tabs. Moat blocks ads, trackers, and hijacked
popups quietly and shows a badge count. Everything stays on your device — no accounts, no
telemetry, no server, and nothing to sell: built for Manifest V3 from day one, not a stripped-down
Lite port of an older extension.

> **Project status:** active development. Builds and tests cover Chrome and Firefox; browser-store
> review, real-world compatibility, and dependency review remain part of every release.

## What it does

- **Network blocking** — ~271,000 `declarativeNetRequest` rules from 11 AdGuard filter lists (ads,
  trackers, malicious/phishing/scam domains, cookie notices, annoyances) plus a few first-party
  ones (GPC header, URL-tracking gaps, tracker coverage-gaps). Runs in the browser engine.
- **Popup/redirect firewall** — silently drops hijacked new-tab popups and redirects, with a
  background tab safety net for anything that slips past.
- **Cosmetic filtering** — hides the leftover ad boxes and cookie banners network blocking can't
  reach, from the AdGuard lists plus uBlock Origin's "Annoyances" cosmetic rules, including
  procedural (`:has-text` / `:xpath` / `:upward`) rules a plain stylesheet can't express.
- **Block-count breakdown** — the popup shows a real Ads / Trackers / Popups split (Chrome only),
  a "Light / Moderate / Heavy" read, and an optional by-company list, expanded in Settings →
  Trackers with a one-line description per company.
- **Element picker** — "Block an element…" to hide anything the lists miss, permanently or just
  once, or gray it out if hiding breaks the layout.
- **Grayed-out video ads** — dims YouTube in-stream ads that can't be blocked outright; sidebar
  "Sponsored" cards are hidden.
- **Feed ad removal** (opt-in) — removes sponsored posts from Instagram, LinkedIn, and YouTube
  feeds by their rendered label.
- **Auto-reject cookie banners** (opt-in) — clicks "reject" on the major consent platforms via a
  declarative rule format, never injected JS.
- **Uncloak disguised trackers** (opt-in) — resolves CNAME-cloaked subdomains and blocks the ones
  that lead to a tracker. Firefox does this with its own DNS resolver and blocks every request;
  Chrome has no DNS API for extensions, so it uses a public DoH lookup instead and can't block the
  very first request to a newly-found cloak — see "Known limitations."
- **Opt-in privacy toggles** — fingerprint resistance, third-party cookie blocking, WebRTC leak
  protection; all off by default.
- **Global Privacy Control** — sends `Sec-GPC`, a legally binding opt-out signal in a dozen US
  states.
- **Leaked-password check** (opt-in) — warns if a password you type has appeared in a known
  breach, via HaveIBeenPwned k-anonymity (only a 5-character hash prefix leaves your device).
- **Filtering levels & custom rules** — Off / Lite / Essential / Standard / Strict presets,
  per-list toggles, and your own block/allow lists.
- **Per-site pause, a keyboard shortcut, settings export/import with opt-in device sync, and a
  "Report a problem" button** — all with no nag UI.
- **Enterprise-managed policy** — push settings org-wide via Chrome's `ExtensionSettings` or
  Firefox's `policies.json`. See [`docs/enterprise.md`](docs/enterprise.md).
- **Localization** — English, plus provisional machine translations for Spanish, French, and
  German.

One codebase, Chrome and Firefox builds. The Firefox build also targets
**Firefox for Android** (`browser_specific_settings.gecko_android`, min
version 142) — same WebExtension APIs and MV3 DNR engine, no separate build;
the options and warning pages carry a mobile viewport meta. How each of these
works is in [`docs/design-notes.md`](docs/design-notes.md).

## Install & build

```
npm install
npm run filters:update   # fetch the AdGuard rulesets into rules/dnr/
npm run build            # build dist/chrome and dist/firefox
```

- `npm test` / `npm run typecheck` — unit suite and types.
- `npm run dev:chrome` / `npm run dev:firefox` — rebuild on change (static assets copied once at
  startup; re-run the plain build if icons/rulesets/manifest change).
- `npm run zip` — `chrome.zip` / `firefox.zip` for store upload.
- CI runs all of the above plus `web-ext lint` on every push; `release.yml` cuts a draft release
  on a `vX.Y.Z` tag.

Re-run `npm run filters:update` periodically for fresher filter rules. It also writes the tracked
`live/redirect-domains.json` — committing that pushes a refreshed redirect blocklist to installed
copies without a store release.

**Load unpacked:**

- **Chrome / Edge / Brave:** `chrome://extensions` → enable Developer mode → Load unpacked →
  `dist/chrome`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
  `dist/firefox/manifest.json`. (Temporary; a persistent local install needs AMO signing.)

## Permissions

| Permission | Why |
| --- | --- |
| `<all_urls>` (host permission) | So the content-script firewall runs on every page and `declarativeNetRequest` can act on every request. |
| `tabs` | Read the URL/opener of new tabs for the popup safety net; show the right badge count per tab. |
| `webNavigation` | Detect when a page spawns a new tab/window, and when a page finishes loading. |
| `declarativeNetRequest` | The core network-blocking engine. |
| `declarativeNetRequestFeedback` | Read-only match feedback for the popup's breakdown (`getMatchedRules`) — Chrome only. |
| `storage` | The paused-sites list and switches, stored locally only. |
| `privacy` | Used only by the opt-in toggles; inert unless one is on. |
| `alarms` | Schedules the once-a-day live redirect-domain refresh. |
| `dns` (Firefox only) | CNAME resolution for "Uncloak disguised trackers"; inert unless that toggle is on. Not requested on Chrome, which has no equivalent API. |
| `webRequest` + `webRequestBlocking` (Firefox only) | Cancel a request once its resolved CNAME target matches a known tracker. Chrome no longer allows blocking `webRequest` under MV3. |
| `webRequest` (Chrome only, non-blocking) | Observe candidate requests for "Uncloak disguised trackers" on Chrome, which gets a weaker DoH-based path instead of Firefox's synchronous one — see "Known limitations." Inert unless that toggle is on. |
| `scripting` | Registers the optional content scripts (feed ad removal, YouTube dimmer) only for the sites each is scoped to instead of every page; injects the service-worker-owned cosmetic CSS; runs the element picker only when you click "Block an element…". |
| `contentSettings` | Sets the browser-level camera/mic/location permission default to "block" for the ambush-prompt guard — a site calling `getUserMedia()`/`getCurrentPosition()` with no user gesture. Chrome only; Firefox's `contentSettings` doesn't cover this surface, so the guard silently no-ops there. Inert unless that toggle is on. |

See [`PRIVACY.md`](PRIVACY.md) for the full policy — what Moat collects (nothing, for any normal
install) and every case its code touches a network.

## Known limitations

- **The breakdown and by-company detail are Chrome-only.** Firefox hasn't shipped
  `declarativeNetRequest.getMatchedRules`. The popup/redirect firewall count still works there.
- **CNAME uncloaking is weaker on Chrome than Firefox.** Chrome has no DNS-resolution API for
  extensions, so it resolves candidate subdomains through a public DoH lookup (Cloudflare) instead
  of Firefox's own resolver, and can't synchronously block the very first request to a
  newly-discovered cloaked tracker in a session — only requests to it after that point. Firefox's
  path blocks every request and involves no third party.
- **The YouTube dimmer and feed scanner are DOM heuristics.** They track each site's current
  markup and can stop matching when it changes; both are togglable, and the feed scanner is off by
  default and English-only.
- **Chrome's static-rule budget is shared across every installed extension** (~30,000 guaranteed;
  Moat ships ~271,000). With other rule-heavy extensions present, some lists may not enable —
  `filterGroups.ts` drops the least-essential first, the Filter Lists tab shows which, and fresh
  installs start on the smaller Lite preset. The ceiling can't be raised from within an extension.
- **`web-ext lint` reports 4 expected warnings, 0 errors** — a false-positive coinminer hit on a
  blocked *domain name* inside a filter list, and feature-detected references to three
  Chrome-only `declarativeNetRequest` debug/feedback APIs Firefox doesn't implement.

## Licensing note

Moat's own code is [GPL-3.0](LICENSE), matching the bundled AdGuard/EasyList filter data so the
whole package sits under one copyleft license. That filter data isn't original to this project —
if you redistribute `rules/dnr/*.json`, keep the attribution and check current terms.

- **Company names** in the "By company" breakdown come from
  [Ghostery's TrackerDB](https://github.com/ghostery/trackerdb), [CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
  — free for non-commercial use, which Moat is.
- **Cookie-banner rules** are vendored from [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)
  (Aarhus University CAVI), MIT. Moat's interpreter (`src/content/consent/`) is written from
  scratch against their schema, not copied.
- **CNAME-cloak destinations** come from [NextDNS's blocklist](https://github.com/nextdns/cname-cloaking-blocklist),
  MIT.

## More

- [`docs/design-notes.md`](docs/design-notes.md) — how the blocking, firewall, cosmetic filtering,
  and each opt-in feature actually work; the "problems we hit" log; and what's deliberately not
  built (and why).
- [`docs/enterprise.md`](docs/enterprise.md) — managed-policy deployment and the optional,
  enterprise-only Athena integration.
- [`PRIVACY.md`](PRIVACY.md) — full privacy policy.
- [`CHANGELOG.md`](CHANGELOG.md) — per-version history.

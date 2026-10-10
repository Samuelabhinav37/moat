# Moat overview

The technical detail behind Moat: what each part does, why it needs each permission, what it can't do yet, and where its data comes from. For how the code is organized and why, see [design-notes.md](design-notes.md).

## What Moat does

- **Network blocking.** ~314,000 filter entries, packed into ~72,000 `declarativeNetRequest`
  rules, from 11 bundled AdGuard filter lists (ads, trackers, malicious/phishing/scam domains,
  cookie notices, annoyances), plus three independent third-party sources for redundant coverage
  (a daily-updated scam-domain list, a community ad/tracker/malware aggregate, and a longstanding
  ad-server list), plus a few first-party ones (GPC header, URL-tracking gaps, tracker coverage
  gaps).
- **Pop-up and redirect firewall.** Silently drops hijacked new-tab pop-ups and redirects, with a
  background-tab safety net for anything that slips past.
- **Cosmetic filtering.** Hides leftover ad boxes and cookie banners network blocking can't reach,
  including procedural (`:has-text` / `:xpath` / `:upward`) rules a plain stylesheet can't express.
- **Auto-reject cookie banners** (on by default). Clicks "reject" on the major consent platforms
  through a declarative rule format, never injected JS.
- **Insights.** Who tracked you (by company, from Ghostery's TrackerDB) and why, the week's busiest
  days and the sites behind them, blocks per site, and the pages Moat stopped. Ads / Trackers /
  Pop-ups split is Chrome only.
- **Safety check.** Moat on, dangerous-site lists on and current, leaked-password warnings, paused
  sites, Never block, and recent restores from a file, each with a one-click fix.
- **Element picker.** Hides anything the lists miss, permanently or just once, or grays it out if
  hiding breaks the layout.
- **Grayed-out video ads.** Dims YouTube in-stream ads that can't be blocked outright.
- **No "you're using an ad blocker" walls from Admiral.** Its bootstrap is stopped before it loads
  anything, so there's no detection, no wall and no "recovered" ads. Skipped on paused sites.
- **Feed ad removal** (opt-in). Removes sponsored posts from Instagram, LinkedIn and YouTube feeds.
- **Uncloak disguised trackers** (opt-in). Resolves CNAME-cloaked subdomains and blocks the ones
  that lead to a tracker: anything on AdGuard's CNAME list or already blocked by Moat's own tracker
  and ad lists (Firefox via its DNS API; Chrome via a public DoH lookup). Skipped on paused sites.
- **Privacy switches** (opt-in, on in Strict). Fingerprint resistance, cross-site cookie blocking,
  WebRTC leak protection.
- **Global Privacy Control.** Sends `Sec-GPC`, a legally binding opt-out signal in a dozen US states.
- **Warn about leaked passwords** (opt-in). HaveIBeenPwned k-anonymity: only a 5-character hash
  prefix leaves the device.
- **Levels and your own rules.** Light / Balanced / Strict (Balanced by default), per-list switches,
  and your own Always block / Never block lists. Dangerous-site lists outrank Never block and pausing.
- **Per-site pause, a keyboard shortcut, backup and restore with a preview and Undo, opt-in sync,
  and Report a problem.**
- **Enterprise-managed policy** via Chrome's `ExtensionSettings` or Firefox's `policies.json`. See
  [`enterprise.md`](enterprise.md).
- **Languages.** English, plus provisional translations for Spanish, French and German.

One codebase builds for Chrome and Firefox. The Firefox build also targets **Firefox for Android**
(`gecko_android`, min version 142) with no separate build.

## Permissions

| Permission | Why |
| --- | --- |
| `<all_urls>` (host permission) | So the content-script firewall runs on every page and `declarativeNetRequest` can act on every request. |
| `webNavigation` | Detect when a page spawns a new tab or window, and when a page finishes loading. |
| `declarativeNetRequest` | The core network-blocking engine. |
| `declarativeNetRequestFeedback` | Chrome only, read-only match feedback for the popup's breakdown (`getMatchedRules`). |
| `storage` | Settings, paused sites and the week's counts, stored locally only. |
| `privacy` | Used only by the opt-in privacy switches; inert unless one is on. |
| `alarms` | Schedules the daily signed list refresh. |
| `dns` (Firefox only) | CNAME resolution for "Uncloak disguised trackers"; inert unless that switch is on. |
| `webRequest` + `webRequestBlocking` (Firefox only) | Cancel a request once its resolved CNAME target matches a known tracker. |
| `webRequest` (Chrome only, non-blocking) | Observes candidate requests for "Uncloak disguised trackers". Inert unless that switch is on. |
| `scripting` | Registers the optional content scripts only for the sites each applies to; injects cosmetic CSS; runs the element picker only when you click "Hide something on this page". |
| `contentSettings` | Sets the camera, microphone and location default to "block" for the opt-in permission guard. Chrome only. Inert unless that switch is on. |
| `browsingData` | Backs the popup's manual "Clear site data" button, scoped to the current site. Never called automatically. |
| `favicon` (Chrome only) | Shows each site's icon beside it in Settings lists, read from Chrome's own local icon cache. No network request. |

## Known limitations

- **The Ads / Trackers / Pop-ups split and by-company detail are Chrome only.** Firefox hasn't
  shipped `declarativeNetRequest.getMatchedRules`. The pop-up and redirect firewall count still
  works there.
- **CNAME uncloaking is weaker on Chrome than Firefox.** Chrome has no DNS API for extensions, so it
  uses a public DoH lookup (Cloudflare) and can't block the very first request to a newly found
  cloaked tracker in a session. Firefox's path blocks every request with no third party involved.
- **The YouTube dimmer and feed scanner are DOM heuristics** and can stop matching when a site
  changes its markup. Both are switchable; the feed scanner is off by default and English only.
- **Browsers cap how many blocking rules an extension can use.** Moat's lists pack ~314,000 filter
  entries into ~72,000 rules; the default level (Balanced) needs ~68,000. When they don't all fit,
  `filterGroups.ts` turns on the most important lists that do (ads first, annoyance lists last),
  and Settings › Protection › Lists shows which were left out.
  - **Chrome** shares a pool of about 330,000 rules between all extensions (~30,000 guaranteed
    each). Balanced fits on its own; other rule-heavy extensions can crowd it.
  - **Firefox** gives each extension 30,000. On Balanced, Moat keeps the ads, trackers, pop-up,
    scam and badware lists and leaves out link tracking and the bundled malware and phishing
    lists. The daily malware and phishing lists stay on, since they don't count toward the limit.
- **`web-ext lint` reports 4 expected warnings, 0 errors**: a false-positive coinminer hit on a
  blocked domain name, plus feature-detected references to Chrome-only debug APIs.

## Licensing and third-party data

Moat's own code is [GPL-3.0](../LICENSE), matching the bundled AdGuard/EasyList/uBlock Origin/
[HaGeZi](https://github.com/hagezi/dns-blocklists)/[oisd](https://github.com/sjhgvr/oisd)
filter data so the whole package sits under one copyleft license. Full third-party license texts
are in [`NOTICE.md`](../NOTICE.md), which ships inside the extension package itself.

- **Company names** in the by-company breakdown come from
  [Ghostery's TrackerDB](https://github.com/ghostery/trackerdb),
  [CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): non-commercial use only.
  Compliant because Moat has no ads, paid tier or monetary compensation tied to it; that would need
  revisiting before any future monetization.
- **Cookie-banner rules** are vendored from [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)
  (Aarhus University CAVI), MIT. Moat's interpreter is written from scratch against their schema.
- **CNAME-cloak destinations** come from
  [AdGuard's cname-trackers list](https://github.com/AdguardTeam/cname-trackers), MIT, plus two
  domains from NextDNS's former list, MIT.
- **Peter Lowe's ad and tracking server list** ([pgl.yoyo.org](https://pgl.yoyo.org/adservers/))
  publishes no explicit redistribution license; it's used with attribution per NOTICE.md.

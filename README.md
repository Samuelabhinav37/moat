<p align="center">
  <img src="icons/logo-banner.svg" width="64" height="64" alt="">
</p>

<h1 align="center">Moat</h1>
<p align="center"><strong>Ad blocking that keeps to itself.</strong><br>
A free, open-source ad blocker for Chrome and Firefox. No server, no account, no telemetry.</p>

<p align="center">
  <a href="https://github.com/Samuelabhinav37/moat/actions/workflows/ci.yml"><img src="https://github.com/Samuelabhinav37/moat/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <img src="https://img.shields.io/badge/manifest-v3-5fb896" alt="Manifest V3">
  <img src="https://img.shields.io/badge/browsers-chrome%20%7C%20firefox-5fb896" alt="Chrome and Firefox">
  <img src="https://img.shields.io/badge/license-GPL--3.0-5fb896" alt="GPL-3.0">
</p>

<p align="center">
  <a href="https://samuelabhinav37.github.io/moat/"><strong>Website</strong></a> ·
  <a href="https://samuelabhinav37.github.io/moat/#faq">FAQ</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/images/readme-demo-still.webp">
    <img src="docs/images/readme-demo.webp" width="800" alt="A WIRED article without Moat: a large ad above the headline takes up 29% of the screen. A divider wipes across to the same page with Moat: it starts at the headline, and Moat's popup shows 18 things blocked on this page.">
  </picture>
</p>

Moat removes ads, trackers, cookie banners and scam pop-ups before a page finishes loading.
Everything happens on your computer, and nothing about you is ever sent anywhere.

> **Coming soon** to the Chrome Web Store and Firefox Add-ons. Until then you can
> [install it from source](#install-it-today) in a few minutes. It works in both browsers today.

## What it does

- **Blocks ads and trackers** on every site, using about 350,000 filter rules that run inside the
  browser's own blocking engine, so pages stay fast.
- **Closes hijacked pop-ups.** Fake prize and fake virus tabs are shut the moment they open.
- **Tidies up the page.** The empty boxes a blocked ad leaves behind collapse, so pages don't look
  broken.
- **Says no to cookie banners** for you, if you switch it on in Settings.
- **Lets you stay in control.** Pause Moat on a site you trust with one switch, or click
  **Block an element…** to hide anything a filter list missed.
- **Optional extras**, all off until you want them: fingerprinting protection, warnings when a
  password you type has leaked in a breach, and uncloaking trackers that hide behind a site's own
  domain.

## Private by design

- **No server.** There's no Moat backend. Blocking happens inside your browser.
- **No account and no telemetry.** Nothing to sign up for, no analytics, no crash reports.
- **One small download a day:** a signed file of filter fixes, checked against a key built into
  the extension before it's used. That request carries nothing about you.
- **Open source.** Anyone can read the code, build it and compare it with what they installed.

The complete details, case by case, are in the [privacy policy](PRIVACY.md).

## Install it today

You'll need [Node.js](https://nodejs.org/) 24 or newer.

```sh
git clone https://github.com/Samuelabhinav37/moat.git
cd moat
npm ci
npm run filters:update   # download the filter lists
npm run build            # builds dist/chrome and dist/firefox
```

Then load it into your browser:

- **Chrome, Edge or Brave:** open `chrome://extensions`, turn on **Developer mode**, click
  **Load unpacked** and choose the `dist/chrome` folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and
  choose `dist/firefox/manifest.json`. Firefox removes temporary add-ons when it restarts; a
  permanent install will come with the Firefox Add-ons listing.

## Questions and problems

- Found a site that breaks, or an ad that gets through? Use **Report a problem…** in Moat's popup,
  or [open an issue](https://github.com/Samuelabhinav37/moat/issues/new/choose).
- Found a security problem? Please report it
  [privately](https://github.com/Samuelabhinav37/moat/security/advisories/new), not as an issue.
- Common questions (is it free, how it makes money, why it needs to read every site) are answered
  in the [FAQ](https://samuelabhinav37.github.io/moat/#faq).

---

## For developers

```sh
npm run typecheck        # types
npm test                 # unit tests
npm run build            # both browsers
npm run lint:firefox     # web-ext lint (4 known warnings, 0 errors)
npm run dev:chrome       # rebuild on change (also dev:firefox)
npm run zip              # chrome.zip / firefox.zip for store upload
```

CI runs all of these on every push. Pushing a `vX.Y.Z` tag builds a draft release; see
[`docs/RELEASING.md`](docs/RELEASING.md). Contributions are welcome: start with
[`CONTRIBUTING.md`](CONTRIBUTING.md).

How the blocking, the pop-up firewall, cosmetic filtering and each opt-in feature actually work
is in [`docs/design-notes.md`](docs/design-notes.md).

<details>
<summary><strong>Everything Moat does, in technical detail</strong></summary>

- **Network blocking.** ~349,000 `declarativeNetRequest` rules from 11 bundled AdGuard filter lists
  (ads, trackers, malicious/phishing/scam domains, cookie notices, annoyances), plus three
  independent third-party sources for redundant coverage (a daily-updated scam-domain list, a
  community ad/tracker/malware aggregate, and a longstanding ad-server list), plus a few
  first-party ones (GPC header, URL-tracking gaps, tracker coverage gaps).
- **Popup/redirect firewall.** Silently drops hijacked new-tab popups and redirects, with a
  background tab safety net for anything that slips past.
- **Cosmetic filtering.** Hides leftover ad boxes and cookie banners network blocking can't reach,
  including procedural (`:has-text` / `:xpath` / `:upward`) rules a plain stylesheet can't express.
- **Block-count breakdown.** Ads / Trackers / Popups split (Chrome only), a "Light / Moderate /
  Heavy" read, and an optional by-company list, expanded in Settings → Trackers.
- **Element picker.** Hides anything the lists miss, permanently or just once, or grays it out if
  hiding breaks the layout.
- **Grayed-out video ads.** Dims YouTube in-stream ads that can't be blocked outright.
- **Feed ad removal** (opt-in). Removes sponsored posts from Instagram, LinkedIn and YouTube feeds.
- **Auto-reject cookie banners** (opt-in). Clicks "reject" on the major consent platforms via a
  declarative rule format, never injected JS.
- **Uncloak disguised trackers** (opt-in). Resolves CNAME-cloaked subdomains and blocks the ones
  that lead to a tracker (Firefox via its DNS API; Chrome via a public DoH lookup).
- **Privacy toggles** (opt-in). Fingerprint resistance, third-party cookie blocking, WebRTC leak
  protection.
- **Global Privacy Control.** Sends `Sec-GPC`, a legally binding opt-out signal in a dozen US states.
- **Leaked-password check** (opt-in). HaveIBeenPwned k-anonymity: only a 5-character hash prefix
  leaves the device.
- **Filtering levels and custom rules.** Off / Lite / Essential / Standard / Strict presets,
  per-list toggles, and your own block/allow lists.
- **Per-site pause, a keyboard shortcut, settings export/import with opt-in sync, and a "Report a
  problem" button.**
- **Enterprise-managed policy** via Chrome's `ExtensionSettings` or Firefox's `policies.json`. See
  [`docs/enterprise.md`](docs/enterprise.md).
- **Languages.** English, plus provisional machine translations for Spanish, French and German.

One codebase builds for Chrome and Firefox. The Firefox build also targets **Firefox for Android**
(`gecko_android`, min version 142) with no separate build.

</details>

<details>
<summary><strong>Permissions, and why each one is needed</strong></summary>

| Permission | Why |
| --- | --- |
| `<all_urls>` (host permission) | So the content-script firewall runs on every page and `declarativeNetRequest` can act on every request. |
| `tabs` | Read the URL/opener of new tabs for the popup safety net; show the right badge count per tab. |
| `webNavigation` | Detect when a page spawns a new tab/window, and when a page finishes loading. |
| `declarativeNetRequest` | The core network-blocking engine. |
| `declarativeNetRequestFeedback` | Chrome-only, read-only match feedback for the popup's breakdown (`getMatchedRules`). |
| `storage` | The paused-sites list and switches, stored locally only. |
| `privacy` | Used only by the opt-in toggles; inert unless one is on. |
| `alarms` | Schedules the once-a-day live redirect-domain refresh. |
| `dns` (Firefox only) | CNAME resolution for "Uncloak disguised trackers"; inert unless that toggle is on. |
| `webRequest` + `webRequestBlocking` (Firefox only) | Cancel a request once its resolved CNAME target matches a known tracker. |
| `webRequest` (Chrome only, non-blocking) | Observes candidate requests for "Uncloak disguised trackers". Inert unless that toggle is on. |
| `scripting` | Registers the optional content scripts only for the sites each applies to; injects cosmetic CSS; runs the element picker only when you click "Block an element…". |
| `contentSettings` | Sets the camera/mic/location permission default to "block" for the opt-in ambush-prompt guard. Chrome only. Inert unless that toggle is on. |
| `browsingData` | Backs the popup's manual "Clear site data…" button, scoped to the current site. Never called automatically. |

</details>

<details>
<summary><strong>Known limitations</strong></summary>

- **The breakdown and by-company detail are Chrome-only.** Firefox hasn't shipped
  `declarativeNetRequest.getMatchedRules`. The popup/redirect firewall count still works there.
- **CNAME uncloaking is weaker on Chrome than Firefox.** Chrome has no DNS API for extensions, so it
  uses a public DoH lookup (Cloudflare) and can't block the very first request to a newly found
  cloaked tracker in a session. Firefox's path blocks every request with no third party involved.
- **The YouTube dimmer and feed scanner are DOM heuristics** and can stop matching when a site
  changes its markup. Both are switchable; the feed scanner is off by default and English-only.
- **Chrome's static-rule budget is shared across every installed extension** (~30,000 guaranteed;
  Moat ships ~349,000). With other rule-heavy extensions present, some lists may not enable:
  `filterGroups.ts` drops the least essential first and the Filter Lists tab shows which. Fresh
  installs start on the Standard preset; Lite or Essential use the smallest footprint.
- **`web-ext lint` reports 4 expected warnings, 0 errors**: a false-positive coinminer hit on a
  blocked domain name, plus feature-detected references to Chrome-only debug APIs.

</details>

<details>
<summary><strong>Licensing and third-party data</strong></summary>

Moat's own code is [GPL-3.0](LICENSE), matching the bundled AdGuard/EasyList/uBlock Origin/
[Scam-Blocklist](https://github.com/jarelllama/Scam-Blocklist)/[oisd](https://github.com/sjhgvr/oisd)
filter data so the whole package sits under one copyleft license. Full third-party license texts
are in [`NOTICE.md`](NOTICE.md), which ships inside the extension package itself.

- **Company names** in the "By company" breakdown come from
  [Ghostery's TrackerDB](https://github.com/ghostery/trackerdb),
  [CC-BY-NC-SA-4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): non-commercial use only.
  Compliant because Moat has no ads, paid tier or monetary compensation tied to it; that would need
  revisiting before any future monetization.
- **Cookie-banner rules** are vendored from [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)
  (Aarhus University CAVI), MIT. Moat's interpreter is written from scratch against their schema.
- **CNAME-cloak destinations** come from
  [NextDNS's blocklist](https://github.com/nextdns/cname-cloaking-blocklist), MIT.
- **Peter Lowe's ad and tracking server list** ([pgl.yoyo.org](https://pgl.yoyo.org/adservers/))
  publishes no explicit redistribution license; it's used with attribution per NOTICE.md.

</details>

## More

- [`docs/design-notes.md`](docs/design-notes.md): how everything works, the "problems we hit" log,
  and what's deliberately not built.
- [`docs/enterprise.md`](docs/enterprise.md): managed-policy deployment.
- [`PRIVACY.md`](PRIVACY.md), [`NOTICE.md`](NOTICE.md), [`CHANGELOG.md`](CHANGELOG.md).
- [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) and
  [`SECURITY.md`](SECURITY.md).
- [`docs/design/handoff/`](docs/design/handoff/): the design handoff behind the current popup and
  Settings UI.

<h1>
  <img alt="Moat logo" src="icons/logo-banner.svg" width="44" valign="middle">
  &nbsp;Moat
</h1>

Moat is a free, open-source ad blocker for Chrome and Firefox. It stops ads, trackers and hijacked
pop-ups before they load, answers cookie banners for you, and runs entirely inside your browser,
with no account and no telemetry.

[![CI](https://github.com/Samuelabhinav37/moat/actions/workflows/ci.yml/badge.svg)](https://github.com/Samuelabhinav37/moat/actions/workflows/ci.yml)

![The Daily Post, a demo news site, without Moat (a large ad above the article, one beside it and one pinned to the bottom) and with Moat (the article starts right under the menu).](docs/images/readme-compare.webp)

## Features

- **Blocks ads and trackers** with about 314,000 filter entries running in the browser's own
  blocking engine, so pages load clean and quick.
- **Closes hijacked pop-ups and redirects**, including pop-under ad networks that move to new
  domains to get past blockers.
- **Answers cookie banners** by choosing "reject" on the major consent platforms.
- **Stops dangerous pages** on daily-updated phishing, malware and scam lists, checked against a
  signed manifest before use.
- **Shows what it did**: who tried to track you and why, the sites with the most blocks, and a
  Safety check that says whether everything that keeps you safe is on.
- **Stays out of the way**: pause it on one site, hide anything the lists miss, and choose Light,
  Balanced or Strict.

## Get started

### Requirements

- Chrome 137 or later, or another Chromium browser such as Edge or Brave
- Firefox 140 or later, or Firefox for Android 142 or later

### Install

Moat is coming to the Chrome Web Store and Firefox Add-ons. Until then, download `chrome.zip` or
`firefox.zip` from the [latest release](https://github.com/Samuelabhinav37/moat/releases/latest),
or build it from source with [Node.js](https://nodejs.org/) 24 or later:

```sh
git clone https://github.com/Samuelabhinav37/moat.git
cd moat
npm ci
npm run filters:update
npm run build
```

Then load it:

- **Chrome:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and
  choose `dist/chrome`, or the unzipped `chrome.zip`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and
  choose `dist/firefox/manifest.json`. Firefox removes temporary add-ons when it restarts.

### Use it

Moat works on its own from the first page you open. When a site breaks, click the Moat icon and
turn off the switch for that site. To hide something the lists miss, click **Hide something on
this page**. Settings has the levels, your own rules and the reports. The website has a short
[guide](https://samuelabhinav37.github.io/moat/#how).

## Privacy

Moat has no account and sends no analytics. Blocking happens in your browser. It downloads signed
filter fixes and danger lists once a day, and those requests carry nothing about you. A problem
report is sent only when you choose to send one, and you see its contents first. The details are
in the [privacy policy](PRIVACY.md).

## Documentation

- [Overview](docs/overview.md): every feature, the permissions and why each is needed, known
  limitations, and third-party data
- [Design notes](docs/design-notes.md): how the blocking, pop-up firewall and cosmetic filtering
  work
- [Enterprise](docs/enterprise.md): deploying Moat with managed policy
- [Releasing](docs/RELEASING.md): how a version is built, checked and published
- [Changelog](CHANGELOG.md)

## Development

```sh
npm run typecheck        # types
npm test                 # unit tests
npm run lint             # ESLint
npm run build            # dist/chrome and dist/firefox
npm run dev:chrome       # rebuild on change (also dev:firefox)
```

CI runs these on every push. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Reporting issues

- A site breaks or an ad gets through: use **Report a problem** in Moat's popup, or
  [open an issue](https://github.com/Samuelabhinav37/moat/issues/new/choose).
- A security problem: report it
  [privately](https://github.com/Samuelabhinav37/moat/security/advisories/new). See
  [SECURITY.md](SECURITY.md).

## License

Moat is released under the [GPL-3.0](LICENSE) license. Third-party filter lists and data keep
their own licenses, listed in [NOTICE.md](NOTICE.md). Participation in this project is governed
by the [Code of Conduct](CODE_OF_CONDUCT.md).

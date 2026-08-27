# Privacy Policy

Moat does not collect, store, sell, or transmit any user data to Moat or
its developer. There is no analytics, no telemetry, no crash reporting, and
no account or sign-in of any kind. This document discloses every case where
Moat's own code talks to a network at all -- most are plain file downloads
that carry nothing about you; two (both off by default) send something
derived from what you typed, to a third party, never to Moat itself.

## What stays on your device

- All settings (which filter lists are on, paused sites, custom block/allow
  rules, custom cosmetic rules) are stored in `browser.storage.local` --
  local to your browser profile, never transmitted anywhere by default, and
  never read by anyone but the extension itself. (See "Opt-in sync" below
  for the one setting that changes this, and only if you turn it on.)
- Ad/tracker blocking, popup/redirect blocking, cosmetic element hiding,
  fingerprint resistance, the YouTube ad dimmer, the feed ad scanner, and
  cookie-banner auto-rejection all run entirely inside your browser against
  page content already on your device. None of it sends page content,
  browsing history, or any other data off your device.
- The per-tab block-count breakdown (Ads/Trackers/Popups, and the optional
  by-company detail) is computed and displayed locally from the browser's
  own `declarativeNetRequest` match data. It is never transmitted.

## What reaches the network, and when

1. **A once-a-day check for updated ad-redirect domains and emergency filter
   fixes.** Moat's background service worker fetches two static JSON files
   from this project's own GitHub repository (`raw.githubusercontent.com`):
   a list of known ad-redirect domains for the popup/redirect firewall, and
   an emergency "quick fixes" filter channel (empty by default; see the
   README) for patching filter breakage faster than a full store release
   allows. Both are plain file downloads -- no data about you, your
   browsing, or your device is sent beyond what any HTTP request inherently
   includes (your IP address, to GitHub's CDN, the same as loading any web
   page).
2. **DNS resolution for CNAME-uncloaking, Firefox only, off by default.** If
   you turn on "Uncloak disguised trackers" in Settings, Moat asks Firefox to
   resolve the canonical (CNAME) name of hostnames your browser contacts, so
   it can tell whether a tracker is disguising itself behind a site's own
   subdomain. This uses your browser's normal, already-configured DNS
   resolver -- Moat does not run or contact any resolver of its own, and this
   never runs at all unless you explicitly enable it. Not available on
   Chrome, which has no equivalent API.
3. **Leaked-password check, off by default.** If you turn on "Check
   passwords against known breaches" in Settings, Moat checks a password you
   type into a page against Have I Been Pwned's Pwned Passwords database,
   using HIBP's k-anonymity API: your password is hashed (SHA-1) on your
   device, and only the **first 5 characters of that hash** are ever sent to
   `api.pwnedpasswords.com` -- never the full hash, and never the password
   itself. This is a request to a third party (HIBP), not to Moat -- Moat's
   own developer never sees it. Off unless you explicitly enable it.
4. **Opt-in settings sync, off by default.** If you turn on "Sync settings"
   in Settings, your settings (excluding the per-install fingerprint-noise
   seed) are mirrored to `browser.storage.sync` -- your browser vendor's own
   sync service (Google's for Chrome, Mozilla's for Firefox), using
   whichever account you're already signed into there, not a server Moat
   runs. This is what lets a fresh install seed itself from an existing
   synced copy. Off unless you explicitly enable it.

Nothing else in Moat makes a network request. In particular: the filter
lists and cosmetic-hiding rules that block ads and trackers are bundled into
the extension at build time (see the project's README for exactly which
lists), not fetched live -- only the two small files in item 1 above are.

## Permissions

See the [Permissions table in the README](README.md#permissions) for what
each requested browser permission is used for and why.

## Changes to this policy

If what Moat collects or transmits ever changes, this document will be
updated in the same pull request as the code change, and the version history
is public in this repository's commit log.

## Contact

Questions or concerns: open an issue on this project's GitHub repository.

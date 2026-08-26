# Privacy Policy

Moat does not collect, store, transmit, or sell any user data. There is no
analytics, no telemetry, no crash reporting, and no account or sign-in of any
kind. This document exists to say that precisely, and to disclose the two
narrow exceptions where Moat's own code talks to a network.

## What stays on your device

- All settings (which filter lists are on, paused sites, custom block/allow
  rules, custom cosmetic rules) are stored in `browser.storage.local` --
  local to your browser profile, never transmitted anywhere, and never read
  by anyone but the extension itself.
- Ad/tracker blocking, popup/redirect blocking, cosmetic element hiding,
  fingerprint resistance, the YouTube ad dimmer, the feed ad scanner, and
  cookie-banner auto-rejection all run entirely inside your browser against
  page content already on your device. None of it sends page content,
  browsing history, or any other data off your device.
- The per-tab block-count breakdown (Ads/Trackers/Popups, and the optional
  by-company detail) is computed and displayed locally from the browser's
  own `declarativeNetRequest` match data. It is never transmitted.

## The two things that do reach the network

1. **A once-a-day check for an updated ad-redirect domain list.** Moat's
   background service worker fetches a static JSON file from this project's
   own GitHub repository (`raw.githubusercontent.com`) to refresh the list of
   known ad-redirect domains the popup/redirect firewall uses. This is a
   plain file download -- no data about you, your browsing, or your device is
   sent beyond what any HTTP request inherently includes (your IP address, to
   GitHub's CDN, the same as loading any web page).
2. **DNS resolution for CNAME-uncloaking, Firefox only, off by default.** If
   you turn on "Uncloak disguised trackers" in Settings, Moat asks Firefox to
   resolve the canonical (CNAME) name of hostnames your browser contacts, so
   it can tell whether a tracker is disguising itself behind a site's own
   subdomain. This uses your browser's normal, already-configured DNS
   resolver -- Moat does not run or contact any resolver of its own, and this
   never runs at all unless you explicitly enable it. Not available on
   Chrome, which has no equivalent API.

Nothing else in Moat makes a network request. In particular: the filter
lists and cosmetic-hiding rules that block ads and trackers are bundled into
the extension at build time (see the project's README for exactly which
lists), not fetched live -- only the one small redirect-domain list above is.

## Permissions

See the [Permissions table in the README](README.md#permissions) for what
each requested browser permission is used for and why.

## Changes to this policy

If what Moat collects or transmits ever changes, this document will be
updated in the same pull request as the code change, and the version history
is public in this repository's commit log.

## Contact

Questions or concerns: open an issue on this project's GitHub repository.

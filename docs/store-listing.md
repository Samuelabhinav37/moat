# Store listing copy

Canonical text for the Chrome Web Store and Firefox Add-ons listings. Keep the
**first sentence the privacy position**, not the feature list — the privacy
story is the category's strongest and is the reason to choose Moat over the
incumbents. Update this file in the same PR as any change to what Moat
collects or transmits, and keep it in sync with `PRIVACY.md` and
`site/index.html`.

---

## Short description (≤132 chars — CWS "summary" / AMO "summary")

> Ad blocker and popup firewall with no server, no account, and no telemetry. Everything runs on your device. Manifest V3, open source.

(129 chars.)

## Full description

Moat is an ad blocker and popup/redirect firewall that keeps to itself: no
server, no account, no telemetry, no crash reporting. Everything it does runs
on your device, against pages already in your browser, and its developer
receives nothing about you under any setting. It is built for Manifest V3 from
day one — not a stripped-down port of an older extension.

**What it does**

- Blocks ads and trackers using bundled AdGuard/EasyList filter data and
  Ghostery's TrackerDB — compiled into the extension, matched by the browser's
  own `declarativeNetRequest` engine.
- Shuts hijacked popups and redirect tabs silently, with a baseline domain list
  plus a small daily-refreshed slice.
- Hides leftover ad boxes and empty containers with cosmetic filtering.
- Auto-rejects cookie-consent banners.
- Optional, all off by default: fingerprint resistance, a YouTube ad dimmer, a
  feed ad scanner, a leaked-password check (via Have I Been Pwned's
  k-anonymity API — a 5-character hash prefix, never the password), and tracker
  CNAME-uncloaking.

**What leaves your device**

Roughly once a day Moat downloads a few small static filter-fix files from a
public GitHub Pages URL — a plain file fetch that carries nothing about you.
The two opt-in features above talk to third parties (Have I Been Pwned; a
public DNS resolver), never to Moat. There is nothing else. Full disclosure:
https://github.com/Samuelabhinav37/moat/blob/master/PRIVACY.md

**Why `<all_urls>`**

A content blocker has to see requests on every site to block them; there is no
narrower permission that does the job. Moat uses it only for blocking and
element-hiding, never to read or transmit page content.

Source (GPL-3.0): https://github.com/Samuelabhinav37/moat

---

## AMO notes-to-reviewer (paste into the AMO submission form)

- No minified/bundled third-party code is shipped un-sourced; the repo builds
  the exact artifact with `npm ci && npm run build` (Node 24). Tag `vX.Y.Z`
  matches `package.json`.
- Remote data only, never remote code: `src/background/liveUpdates.ts` fetches
  JSON (block/allow domain lists + CSS selector strings) from GitHub Pages,
  verifies an Ed25519 signature on the manifest and a SHA-256 per payload, and
  passes selectors through `isSafeCosmeticSelector`. No `eval`, no
  `Function()`, no script injection from the network.
- `webRequest` (Chrome) is non-blocking, used only when "Uncloak disguised
  trackers" is enabled.

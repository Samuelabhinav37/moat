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

---

## Chrome Web Store dashboard fields (Privacy practices tab)

**Privacy policy URL**

> https://samuelabhinav37.github.io/moat/

**Single purpose description**

> Moat blocks ads, trackers, and hijacked popups/redirects, and hides the
> cosmetic leftovers (empty ad boxes, cookie banners) that blocking can't
> reach. Every other toggle (fingerprint resistance, feed ad removal, leaked-
> password check, CNAME uncloaking, GPC) is a variant of the same purpose —
> stopping a page from tracking, redirecting, or serving unwanted content to
> the person viewing it — not an unrelated bundled feature.

**Are you using remote code?**

> No. `src/background/liveUpdates.ts` fetches signed/hash-verified JSON
> (domain lists and CSS selector strings) from a GitHub Pages URL we control,
> never executable code. Nothing is `eval`'d or run via `Function()`; fetched
> selectors are passed through `isSafeCosmeticSelector` before use the same as
> every bundled selector.

**Permission justifications** (paste one per permission the dashboard flags)

| Permission | Justification |
| --- | --- |
| Host permission `<all_urls>` | Core functionality: a content blocker must see requests and page content on every site to block/hide on it. No narrower host permission covers this. |
| `tabs` | Read the URL/opener of a newly opened tab to distinguish a real navigation from a hijacked popup/redirect, and show the correct per-tab block count on the toolbar icon. |
| `webNavigation` | Detect when a page opens a new tab/window and when navigation completes, to run the popup/redirect firewall at the right moment. |
| `declarativeNetRequest` | Core network-blocking engine — all ad/tracker/malware blocking runs through this API, matched by the browser itself. |
| `declarativeNetRequestFeedback` | Read-only match feedback (`getMatchedRules`) to show the user which categories (ads/trackers/popups) were blocked on the current page. |
| `storage` | Store the user's own settings and per-site pause list locally on-device. Never transmitted. |
| `privacy` | Backs the opt-in privacy toggles (third-party cookie blocking, WebRTC leak protection); inert unless the user turns one on. |
| `alarms` | Schedule the daily check for a refreshed popup/redirect domain list and cosmetic-fix file. |
| `scripting` | Register the optional content scripts (feed ad removal, YouTube dimmer) scoped only to the sites each applies to; inject cosmetic CSS from the background service worker; run the element picker only when the user clicks "Block an element…". |
| `webRequest` (non-blocking) | Observe candidate requests for the opt-in "Uncloak disguised trackers" feature; inert unless that toggle is on. Chrome's MV3 `webRequest` can no longer block, so this is observation-only feeding `declarativeNetRequest` dynamic rules. |
| `contentSettings` | Set the browser-level camera/microphone/location permission default to "block" for the opt-in ambush-prompt guard (a site requesting one with no user gesture). Inert unless that toggle is on. |

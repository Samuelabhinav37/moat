# Store listing copy

Canonical text for the Chrome Web Store and Firefox Add-ons listings. Keep the
**first sentence the privacy position**, not the feature list — the privacy
story is the category's strongest and is the reason to choose Moat over the
incumbents. Update this file in the same PR as any change to what Moat
collects or transmits, and keep it in sync with `PRIVACY.md` and
`site/index.html`.

---

## Images

Screenshots, promo tile and marquee live in `store-assets/` (see its README for which file
goes in which slot and how to rebuild them).

## Short description (CWS "summary")

The Chrome Web Store takes the summary from the manifest's description (`extDescription` in
`src/_locales/*/messages.json`), so it can't be edited in the dashboard:

> Blocks ads, trackers and pop-up tabs, with no nag screens.

## Full description

Moat stops ads, trackers and hijacked pop-ups before they load, so pages arrive clean and quick.
It needs no account, sends no analytics, and does its blocking inside your browser.

WHAT IT DOES
• Blocks ads and trackers with about 314,000 built-in filters, matched by Chrome's own blocking engine.
• Closes pop-up tabs and redirects that hijack your clicks, including ads in embedded video players.
• Answers cookie banners for you, with optional cookies turned off.
• Stops phishing, malware and scam pages before they open, using lists that update every day.
• Hides the empty boxes ads leave behind, and anything else you point at with "Hide something on this page".
• Shows who tried to track you this week and why, the sites with the most blocks, and a Safety check that says whether everything that keeps you safe is on.
• Pause it on one site with a single switch. Every other site stays protected.
• Choose Light, Balanced (the default) or Strict. Extras like cross-site cookie blocking and leaked-password warnings each have their own switch.

PRIVATE BY DESIGN
• No account, no analytics, no crash reports.
• Blocking happens in your browser. The pages you visit aren't sent anywhere to be checked.
• Once a day Moat downloads small signed files of filter fixes and danger lists from a public GitHub Pages address. Moat checks their signature before using them, and the download carries nothing about you.
• Two optional features use outside services: leaked-password warnings send a 5-character hash prefix to Have I Been Pwned (never the password), and "Uncloak disguised trackers" looks up tracker hostnames with a public DNS resolver. Both are off until you turn them on.
• A problem report reaches the developer only when you choose to send one, and you see what's in it first.

WHY IT NEEDS ACCESS TO ALL SITES
An ad blocker has to see a page's requests to block them. Moat uses that access only to block and hide content, never to read or send page content.

Free and open source (GPL-3.0): https://github.com/Samuelabhinav37/moat
Privacy policy: https://github.com/Samuelabhinav37/moat/blob/master/PRIVACY.md

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

> https://github.com/Samuelabhinav37/moat/blob/master/PRIVACY.md

(Link the policy itself, not the landing page, so a reviewer lands on it directly.)

**Single purpose description**

> Moat blocks ads, trackers, and hijacked popups/redirects, and hides the
> cosmetic leftovers (empty ad boxes, cookie banners) that blocking can't
> reach. Every other toggle (fingerprint resistance, feed ad removal, leaked-
> password check, low-quality search-result hiding, CNAME uncloaking, GPC) is a variant of the same purpose —
> stopping a page from tracking, redirecting, or serving unwanted content to
> the person viewing it — not an unrelated bundled feature.

**Are you using remote code?**

> No. `src/background/liveUpdates.ts` fetches signed/hash-verified JSON
> (domain lists and CSS selector strings) from a GitHub Pages URL we control,
> never executable code. Nothing is `eval`'d or run via `Function()`; fetched
> selectors are passed through `isSafeCosmeticSelector` before use the same as
> every bundled selector.

**Data usage** (the "What user data do you plan to collect" checkboxes)

Tick **Web history** only. A problem report the user chooses to send carries the site's name
(the full address only if they tick the box), and "Uncloak disguised trackers" (opt-in) looks up
tracker hostnames with a public DNS resolver. Leave every other category unticked: the
leaked-password check sends a 5-character hash prefix, not credentials, and nothing else leaves
the device. Then tick all three certifications (not sold to third parties; not used or
transferred for purposes unrelated to the single purpose; not used to determine
creditworthiness). Keep this in step with `PRIVACY.md` — a mismatch between these boxes and the
policy is a common rejection reason.

**Permission justifications** (paste one per permission the dashboard flags)

| Permission | Justification |
| --- | --- |
| Host permission `<all_urls>` | Core functionality: a content blocker must see requests and page content on every site to block/hide on it. No narrower host permission covers this. |
| `webNavigation` | Detect when a page opens a new tab/window and when navigation completes, to run the popup/redirect firewall at the right moment. |
| `declarativeNetRequest` | Core network-blocking engine — all ad/tracker/malware blocking runs through this API, matched by the browser itself. |
| `declarativeNetRequestFeedback` | Read-only match feedback (`getMatchedRules`) to show the user which categories (ads/trackers/popups) were blocked on the current page. |
| `storage` | Keeps the user's settings, paused sites and the week's block counts shown in Settings, on the device. Never transmitted. |
| `privacy` | Backs the opt-in privacy toggles (third-party cookie blocking, WebRTC leak protection); inert unless the user turns one on. |
| `alarms` | Schedules the daily download of signed filter fixes and danger lists, ends a timed pause ("pause for 1 hour") on time, and refreshes an organization's managed policy where one is set. |
| `scripting` | Register the optional content scripts (feed ad removal, YouTube dimmer) scoped only to the sites each applies to; inject cosmetic CSS from the background service worker; run the element picker only when the user clicks "Hide something on this page…". |
| `webRequest` (non-blocking) | Observe candidate requests for the opt-in "Uncloak disguised trackers" feature; inert unless that toggle is on. Chrome's MV3 `webRequest` can no longer block, so this is observation-only feeding `declarativeNetRequest` dynamic rules. |
| `contentSettings` | Set the browser-level camera/microphone/location permission default to "block" for the opt-in ambush-prompt guard (a site requesting one with no user gesture). Inert unless that toggle is on. |
| `browsingData` | Backs the popup's manual "Clear site data…" button: on click, clears the active tab's own cookies, IndexedDB, local storage and service workers for that one site. Never called automatically and never touches other sites. |
| `favicon` | Show each site's icon beside its name in the Settings page's paused-site and block/allow lists, read from Chrome's local favicon cache. No network request is made and nothing is sent anywhere. |

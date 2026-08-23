# Silent Adblock

An ad blocker for Chrome and Firefox that also acts as a firewall against
popup/redirect ads that spawn new tabs without you asking for them. It has no
nag screens, no "rate us" prompts, and no onboarding tabs — it just blocks
things quietly and shows a badge count.

## How it works

- **Network blocking** — ships `declarativeNetRequest` rulesets compiled
  from eleven AdGuard filter lists, refreshed from `@adguard/dnr-rulesets`:
  Base, Tracking Protection, URL Tracking, and Popups for ads/trackers;
  Online Malicious URL, Phishing URL, Scam, and Badware-risks for actual
  malware/phishing domains (this is the "firewall" half — it blocks known-bad
  sites outright, not just ads); Social Media, Cookie Notices, and Other
  Annoyances for the trackers/nags those don't otherwise catch. ~273,000
  rules total, well under Chrome's static-rule budget. This all runs in the
  browser engine, not a JS handler (which MV3 no longer allows for blocking).
- **Global Privacy Control** — sends the `Sec-GPC: 1` header on every
  request (our own small rule, `ruleset_privacy-headers`) and exposes
  `navigator.globalPrivacyControl = true` in every page. As of 2026 this is
  a legally binding opt-out signal in a dozen US states. On Firefox we also
  flip its native `privacy.network.globalPrivacyControl` setting, which is
  likely more complete than our own header/property patch.
- **Popup/redirect firewall** — a content script injected into the page's
  own JS context (`world: "MAIN"`) wraps `window.open` and intercepts
  script-dispatched clicks on `target="_blank"` links. It only lets a new
  tab open when there's a genuine, recent, on-target user gesture behind it
  (checked via `navigator.userActivation` plus the actual clicked element,
  not just "some click happened somewhere recently"). Everything else is
  silently dropped — no browser popup-blocked notification bar, nothing.
- **Background safety net** — in case a popup slips past the content script
  (a frame our script never ran in, a race condition), the background worker
  watches newly created tabs and silently closes any that land on a domain
  from the AdGuard Popups/URL Tracking lists.
- **Per-site pause + master switch** — click the toolbar icon to pause
  protection on the current site, or open Settings for the full list and a
  master on/off switch. Nothing else asks for your attention.
- **Opt-in browser-wide privacy toggles** — Settings has two switches, off
  by default because they change behavior outside of what's on-screen:
  blocking third-party cookies and WebRTC IP-leak protection, both applied
  via the `privacy` API (`src/background/privacySettings.ts`). Chrome and
  Firefox expose third-party cookie blocking under genuinely different
  shapes; that file feature-detects and handles both.

See `src/` for the source layout: `background/` (service worker / event
page), `content/` (the two content scripts — `mainWorldGuard.ts` for the
page-context guard, `bridge.ts` for the isolated-world relay to extension
storage/messaging), `popup/` and `options/` (UI), `types.ts` (shared
message/settings shapes), and `scripts/manifest.ts` (builds `manifest.json`
per browser target). The heuristics with the most test coverage each live in
their own side-effect-free module so they're importable without a browser
environment: `content/isPlausibleTrigger.ts` (the popup-firewall trigger
check) and `background/redirectDomainMatch.ts` (the tab safety net's domain
matcher) — both are thin wrappers imported by the files that actually
register listeners.

## Setup

```
npm install
npm run filters:update   # pulls the AdGuard DNR rulesets into rules/dnr/
npm run validate:rules   # sanity-checks them (schema, duplicate ids)
npm run build             # builds dist/chrome and dist/firefox
```

Re-run `npm run filters:update` periodically to pick up newer filter rules
(the underlying package publishes new rulesets frequently).

`npm run dev:chrome` / `npm run dev:firefox` rebuild on file changes
(static assets — icons, rulesets, manifest — are only copied once at
startup of the watch, so re-run the plain build if those change).

`npm run test` runs the unit test suite (Vitest) — mainly the pure logic
behind the popup-firewall heuristic, the redirect-domain matcher, the
filter-chunking used to stay under Firefox's file-size lint limit, and the
Chrome/Firefox privacy-API branching. `npm run typecheck` runs `tsc --noEmit`.
`.github/workflows/ci.yml` runs all of the above plus a full build and the
Firefox lint on every push.

`npm run zip` produces `chrome.zip` and `firefox.zip` for store upload.

## Loading it locally

**Chrome / Edge / Brave:** open `chrome://extensions`, enable Developer
mode, click "Load unpacked", and select `dist/chrome`.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load
Temporary Add-on", and select `dist/firefox/manifest.json`. (Temporary
add-ons are removed when Firefox restarts; for a persistent local install
you'd need to sign it through AMO, even for self-distribution.)

## Known limitations

- **~990 filter rules dropped.** A small slice of AdGuard's rules neutralize
  ad scripts by redirecting them to a bundled no-op resource file
  (`$redirect` rules). We don't ship those resource files yet, so
  `scripts/update-filters.mjs` drops that slice rather than ship a broken
  redirect. Everything else (the vast majority — 273,000+ rules) is intact.
- **`web-ext lint` warnings on the Firefox build are expected and benign:**
  one is a Firefox-for-Android version nuance from bumping
  `strict_min_version` to 140 for `data_collection_permissions` support; the
  other (`COINMINER_USAGE_DETECTED`) is the linter's naive keyword scanner
  tripping over a cryptominer *domain name* inside the AdGuard Base filter's
  own block rules — the file is static JSON blocking that domain, not code
  that runs it.

## Licensing note

The bundled filter lists are distributed under GPL-3.0 by AdGuard/EasyList
contributors. If you publish this extension, keep the attribution above and
check current license terms before distributing `rules/dnr/*.json` — that
data isn't original to this project.

## Permissions

- `<all_urls>` host permission — needed so the content-script firewall runs
  on every page and `declarativeNetRequest` can act on every request.
- `tabs` — to read the URL/opener of newly created tabs for the popup
  safety net (and to show the right badge count per tab).
- `webNavigation` — to detect when a page spawns a new tab/window.
- `storage` — the paused-sites list and switches, stored locally only.
  Nothing is sent anywhere.
- `privacy` — only used by the two opt-in toggles above; unused (and
  invisible to the user) unless they turn one on.

## Researched but not built yet

From a pass on what a more complete privacy tool would also do:

- **Cosmetic filtering / element hiding** — `declarativeNetRequest` is
  network-only; hiding leftover empty ad boxes or auto-handling cookie
  banners needs parsing `##selector` rules and injecting scoped CSS
  per-site. Real work, not yet done.
- **Fingerprinting resistance** (canvas/AudioContext/font-enumeration
  noise) — valuable as sites lean on fingerprinting once cookies/domains
  are blocked, but it's the one category that can silently break real
  sites (canvas CAPTCHAs, WebGL apps), so it'd need to ship as an explicit
  "strict mode" opt-in rather than default-on.
- **Live filter updates** — rulesets are baked in at build time; MV3 allows
  fetching plain JSON at runtime and loading it as dynamic rules, but the
  dynamic-rule budget is far smaller than our ~273k static rules, so it
  could only supplement a small hot-list on top of, not replace, periodic
  rebuilds.
- **CNAME-cloaked trackers** — first-party-disguised trackers can't be
  reliably caught without DNS resolution access, which Chrome doesn't
  expose to extensions. Not solvable here.

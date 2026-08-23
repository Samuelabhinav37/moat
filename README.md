# Moat

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
- **Cosmetic filtering** — hides the leftover empty ad boxes and cookie
  banners `declarativeNetRequest` can't touch (it's network-only). A
  build-time script (`scripts/update-cosmetics.mjs`) downloads the raw
  filter-list text, parses standard `##selector`/`#@#`-exception cosmetic
  rules (skipping AdGuard/uBO scriptlets and CSS-injection/extended-selector
  syntax that need a JS engine, not a `<style>` tag — see the comment atop
  `scripts/lib/parseCosmeticRules.mjs`), and validates every surviving
  selector against jsdom so nothing invalid ships. A content script
  (`src/content/cosmeticFilter.ts`, top frame only) injects the selectors
  that apply to the current hostname as one `<style>` block at
  `document_start` — CSS rules, not a one-time DOM pass, so they keep
  hiding elements a site adds later (SPA navigation, lazy-loaded slots)
  without a MutationObserver.
- **Live redirect-domain updates** — the bulk of blocking (~273k rules)
  stays build-time/static; MV3's dynamic-rule budget is nowhere near large
  enough to hold that. But the popup/redirect domain list (currently ~460
  domains) is small enough to refresh daily: `src/background/liveUpdates.ts`
  fetches whatever's currently committed to `live/redirect-domains.json` on
  GitHub and applies it as dynamic `declarativeNetRequest` rules, on top of
  the bundled baseline. Publishing a refresh is just `npm run filters:update`
  + commit + push — there's no scheduled automation writing to the repo on
  its own, so this stays under your control. Settings shows the last
  successful check.
- **Opt-in fingerprint resistance** — a third toggle, off by default:
  deterministic per-install noise on canvas (`toDataURL`/`toBlob`/
  `getImageData`) and `AudioBuffer.getChannelData` reads, a generic WebGL
  vendor/renderer string in place of your real GPU, and
  `navigator.hardwareConcurrency`/`deviceMemory` rounded to common values.
  "Deterministic" matters here: the same canvas content on the same install
  always noises the same way, so a site re-reading it twice can't tell
  anything changed — but different installs get different noise, which is
  what actually defeats cross-site fingerprint correlation. Off by default
  because, unlike blocking, this is the one feature that can occasionally
  change what a page observes (e.g. a canvas-based CAPTCHA).
- **Filtering levels + per-list control** — Settings' Filter Lists tab has a
  preset picker (Off / Essential / Standard / Strict) and an on/off switch
  for each of the 11 bundled lists, grouped by category. Toggling one
  applies instantly via `declarativeNetRequest.updateEnabledRulesets` — no
  rebuild, no reinstall. Picking a preset that doesn't match your current
  switches shows as "Custom," the same way an OS power-plan picker detects
  manual drift (`src/options/filterPresets.ts`).
- **Custom rules** — the Custom Rules tab lets you block or allow-list
  specific sites yourself, applied as dynamic `declarativeNetRequest` rules
  (`src/background/customRules.ts`) in their own reserved id range so they
  never collide with the live-update rules above.
- **Element picker** — "Block an element…" in the toolbar popup turns on a
  hover-and-click picker (`src/content/elementPicker.ts`) covering both of
  uBlock Origin's manual tools in one flow: **Hide on this site** saves the
  generated selector (`src/content/generateSelector.ts` — prefers a stable
  id, then stable classes, then a short structural path, rejecting
  generated-looking identifiers along the way) so it's reapplied on future
  visits, same mechanism as the bundled cosmetic rules; **Hide for now**
  applies immediately but nothing is saved, gone on the next reload — uBO's
  Zapper behavior. Picks are listed under Custom Rules → Hidden elements.
- **Enterprise-managed policy** — an admin can push settings across an
  organization via Chrome's `ExtensionSettings` policy or Firefox's
  `policies.json` `3rdparty` key (schema: `src/managed_schema.json`):
  force protection on, lock the filter-list toggles, or add an org-wide
  blocklist on top of whatever the user's already added. Locked controls
  show a "Managed by your organization" badge instead of silently
  overriding the user with no explanation.

See `src/` for the source layout: `background/` (service worker / event
page), `content/` (the three content scripts — `mainWorldGuard.ts` for the
page-context popup guard, `bridge.ts` for the isolated-world relay to
extension storage/messaging, `cosmeticFilter.ts` for element hiding),
`popup/` and `options/` (UI), `shared/domainChain.ts` (the "is this hostname
this domain or a subdomain of it" check used by both the popup safety net
and cosmetic filtering), `types.ts` (shared message/settings shapes), and
`scripts/manifest.ts` (builds `manifest.json` per browser target). The
heuristics with the most test coverage each live in their own
side-effect-free module so they're importable without a browser
environment: `content/isPlausibleTrigger.ts` (the popup-firewall trigger
check), `background/redirectDomainMatch.ts` (the tab safety net's domain
matcher), and `content/cosmeticSelectors.ts` (which selectors apply to a
given hostname) — all thin wrappers imported by the files that actually
register listeners or touch the DOM. Same pattern for the newer additions:
`options/filterPresets.ts`, `background/filterGroupState.ts`,
`background/managedPolicyMerge.ts`, and `shared/rulesetManifest.ts` are all
pure and directly tested; `background/filterGroups.ts`,
`background/applyCustomRules.ts`, and `background/managedPolicy.ts` are the
thin browser-API wrappers around them.

See `CHANGELOG.md` for what shipped in each version, or the in-extension
About tab (Settings → About) for a shorter version plus the privacy policy.

## Setup

```
npm install
npm run filters:update   # pulls the AdGuard DNR rulesets into rules/dnr/
npm run validate:rules   # sanity-checks them (schema, duplicate ids)
npm run build             # builds dist/chrome and dist/firefox
```

Re-run `npm run filters:update` periodically to pick up newer filter rules
(the underlying package publishes new rulesets frequently). It runs two
steps: `update-filters.mjs` copies the prebuilt DNR rulesets out of
`node_modules` (no network needed), then `update-cosmetics.mjs` downloads
the raw filter-list text from AdGuard's CDN to extract cosmetic rules from
(this one does need network access, including in CI).

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

`filters:update` also writes `live/redirect-domains.json` — unlike
`rules/dnr/` (build output, gitignored), this one is a tracked file:
committing and pushing it is how a refreshed redirect-domain list reaches
already-installed copies of the extension (see "Live redirect-domain
updates" above) without a new store release.

## Loading it locally

**Chrome / Edge / Brave:** open `chrome://extensions`, enable Developer
mode, click "Load unpacked", and select `dist/chrome`.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load
Temporary Add-on", and select `dist/firefox/manifest.json`. (Temporary
add-ons are removed when Firefox restarts; for a persistent local install
you'd need to sign it through AMO, even for self-distribution.)

## Enterprise deployment

An admin can push policy via Chrome's `ExtensionSettings` policy (Group
Policy / Chrome Browser Cloud Management) or Firefox's `policies.json`
`3rdparty` key, targeting this extension's id and setting values matching
`src/managed_schema.json`. Chrome example (`ExtensionSettings` policy value,
keyed by extension id):

```json
{
  "<extension-id>": {
    "installation_mode": "force_installed",
    "update_url": "https://clients2.google.com/service/update2/crx",
    "policy": {
      "forceEnabled": true,
      "lockFilterGroups": true,
      "managedFilterGroups": { "ads": true, "trackers": true, "malicious-urls": true },
      "managedCustomBlockedDomains": ["known-bad-domain.example"]
    }
  }
}
```

Firefox equivalent goes under `3rdparty.Extensions["<extension-id>"]` in
`policies.json` with the same `policy` object shape. I built and unit-tested
this against the documented policy mechanism but haven't verified it against
a real managed browser profile — worth a manual check (`chrome://policy`
shows whether Chrome picked up the value) before relying on it in production.

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
- `alarms` — schedules the once-a-day live redirect-domain-list refresh.

## Researched but not built yet

From a pass on what a more complete privacy tool would also do:

- **Cookie-banner auto-rejection** — cosmetic filtering hides banners that
  match a plain selector, but AdGuard's Cookie Notices list mostly handles
  *auto-clicking* "reject" for you via scriptlets, which we deliberately
  don't execute (see above). So banners without a matching hide-selector
  will still show up, just not auto-dismiss.
- **Font-enumeration fingerprinting** isn't covered by the fingerprint-
  resistance toggle — canvas, audio, WebGL, and the two navigator hints are.
  Spoofing the installed-fonts list needs a different technique (font
  substitution or measurement-based noise) not implemented here.
- **CNAME-cloaked trackers** — first-party-disguised trackers can't be
  reliably caught without DNS resolution access, which Chrome doesn't
  expose to extensions. Not solvable here.

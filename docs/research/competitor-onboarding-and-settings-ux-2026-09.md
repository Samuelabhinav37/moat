# Competitor onboarding and settings UX: uBlock Origin, AdGuard, Ghostery, Privacy Badger (September 2026)

A point-in-time UX/design research pass, not an architecture deep-dive. Scope: does each
competitor auto-open a tab on install, what's actually on it, what its settings/popup visual
design looks like, and how it explains defaults to a brand-new user. Written to inform the
"no onboarding tabs" tension already flagged (but not resolved) in
[`simplicity-and-completeness-review.md`](simplicity-and-completeness-review.md) §1c: Moat's
README states "No nag screens, no 'rate us' prompts, no onboarding tabs" as a deliberate
philosophy, and that doc recommended a minimal popup-card first-run notice as the option
consistent with it — flagged as a decision for the project owner, not something to resolve
unilaterally. This doc doesn't make that decision; it gathers what real competitors actually do
so the decision can be made with real data instead of assumption.

**Sourcing method**: primary sources only — each extension's own GitHub source (background
scripts, manifest/`onInstalled` listeners, HTML/CSS of any first-run page, design-token CSS
files), official help/KB pages, and the EFF's own blog for Privacy Badger. Where source code was
the only reliable way to verify "does it auto-open a tab," that's what was read — installing each
extension live was not available to this research pass, so that gap is called out explicitly
wherever it applies. All GitHub source was read live against each project's default branch on
2026-09-19; branch/file paths are cited so a future pass can re-check them.

---

## 1. uBlock Origin (full MV2/MV3, `gorhill/uBlock`)

### Post-install flow: confirmed — does NOT auto-open a tab
Searched `gorhill/uBlock`'s entire `src/js/` directory and platform-specific bootstrap files
(`platform/chromium/webext.js`, `src/js/ublock.js`, `src/js/background.js`, `src/js/start.js`)
for any `onInstalled` listener, `reason === "install"` check, or `tabs.create` call tied to
install — none exist anywhere in the source tree
([`gorhill/uBlock`](https://github.com/gorhill/uBlock/tree/master/src/js)). The full page
inventory under `src/` (`about.html`, `dashboard.html`, `popup-fenix.html`, `settings.html`,
`support.html`, etc. — [file listing](https://github.com/gorhill/uBlock/tree/master/src)) has no
`welcome.html` or `onboarding.html`. This is a genuine absence, not a naming mismatch: GitHub's
code-search API returned zero hits for `onInstalled` anywhere in the repo. uBO starts blocking
immediately on install with no tab, no dialog, nothing.

### uBO Lite (uBOL, `uBlockOrigin/uBOL-home`) — same finding
Same check against uBOL's own `chromium/js/` directory (39 files, including `background.js`,
`admin.js`) — no `onInstalled` listener, no `welcome`/`onboarding` HTML file in
`chromium/*.html` ([file listing](https://github.com/uBlockOrigin/uBOL-home/tree/main/chromium)).
uBOL's own README states its default ruleset (uBO's own lists, EasyList, EasyPrivacy, Peter
Lowe's list) is active immediately, and that additional rulesets are reached "by visiting the
options page — click the Cogs icon in the popup panel"
([uBOL-home README](https://github.com/uBlockOrigin/uBOL-home)) — i.e. settings exist and are
one click from the popup, but nothing pushes a new user there.

### Visual design
Dashboard (`dashboard.html`) is a classic tabbed single-page app (Settings / Filter lists / My
filters / Trusted sites / My rules tabs), functional and dense rather than designed — consistent
with the project's long-standing "developer tool that happens to have a UI" character. Not
independently re-verified with a fresh screenshot this pass (no live install); this is consistent
with the file/tab structure visible in the source tree above and widely known.

### How it explains defaults
No explicit new-user explanation found in the source or wiki beyond the popup itself (below).
uBO's wiki has a [dedicated "Quick guide: popup user interface"
page](https://github.com/gorhill/uBlock/wiki/Quick-guide%3A-popup-user-interface) but it's
reference documentation a user has to go find, not something surfaced to them.

### Popup vs. full settings
Per uBO's own wiki page: the popup shows a large power button (global/per-site toggle, "Ctrl-click
to turn off uBO only for the current page"), block-count stats since install, a per-page blocked
vs. total-connections ratio, per-site switches, and icons for the element zapper, element picker,
issue reporting, and the logger. The gear icon "opens the uBO Dashboard" — one click from popup to
full settings, but the wiki page itself notes no onboarding, tooltip, or first-run guidance
anywhere in that flow
([uBO wiki: Quick guide, popup user interface](https://github.com/gorhill/uBlock/wiki/Quick-guide%3A-popup-user-interface)).

### Guided tours/tooltips
None found — neither in source nor documented on the wiki.

---

## 2. AdGuard (browser extension, `AdguardTeam/AdguardBrowserExtension`)

### Post-install flow: confirmed — auto-opens a tab, and it's a two-stage, cross-sell-heavy flow
`Extension/src/background/app/app-common.ts` explicitly detects a fresh install
(`isInstall = isAppVersionChanged && !previousAppVersion`) and, only on that branch, calls
`await PagesApi.openPostInstallPage()`
([`app-common.ts`](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/src/background/app/app-common.ts)).
`openPostInstallPage()` does `browser.tabs.create({ url: postInstallPageUrl })` — a **local**
extension page (`Extension/src/pages/post-install.ts`) that shows a progress bar (using the
`Nanobar` library) while it polls the background for "is the filter engine ready yet," then swaps
that same tab's URL to an **external, hosted** "thank you" page on `link.adtidy.org` (which
redirects to `welcome.adguard.com`) via
[`pages-common.ts`'s `openThankYouPage()`](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/src/background/api/ui/pages/pages-common.ts)
— so the local extension page is just a ~1-second loading screen; the actual "welcome" content
lives on AdGuard's own marketing site, not in the extension bundle.

Live-fetching that redirect target (`welcome.adguard.com/v2/thankyou.html`, as of 2026-09-19,
so this specific marketing page can and likely will change independent of the extension's own
code) shows a genuinely heavy page: it opens "Thank you for installing AdGuard!," then a "Step 2:
Let's block even more ads!" section pitching AdGuard's other apps (Windows/Mac/Android/iOS),
setup checkboxes (tracker blocking, social-widget removal, search-ad filtering, "anonymous filter
improvement" data sharing, with a note that the data-sharing option "may slow down websites on
older devices"), an explicit disclosure of what usage data it collects (screen names, button
clicks, session IDs) with a privacy-policy link, and heavy cross-promotion for AdGuard VPN, DNS,
and Mail with download buttons and QR codes throughout. The forward-link's own query parameter
literally includes `show_telemetry_consent=true`
([`post-install.ts`](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/src/pages/post-install.ts);
[`forward.ts`](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/src/common/forward.ts)
for the URL construction). This is the heaviest first-run experience of the four researched here
— not just an in-product tour, but a full marketing/cross-sell landing page.

### Visual design
Settings ("Options") page is a React app with an explicit `Sidebar` component and per-section
folders (`General`, `Filters`, `Stealth`, `Allowlist`, `UserRules`, `About`, etc.) — sidebar-nav
pattern, not tabs
([component directory listing](https://github.com/AdguardTeam/AdguardBrowserExtension/tree/master/Extension/src/pages/options/components)).
Design tokens (`Extension/src/pages/common/styles/vars.pcss`) define a green "product primary"
palette (`--product-primary-50: #67b279` and shades from `#f7fbf8` to `#243e2a`), a neutral gray
scale, and explicit dark-mode support via both a `@media (prefers-color-scheme: dark)` block and a
manually-toggleable `.dark-mode` class
([`vars.pcss`](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/src/pages/common/styles/vars.pcss)).
Typeface is Roboto Flex
([`fonts.css`](https://github.com/AdguardTeam/AdguardBrowserExtension/blob/master/Extension/assets/css/fonts.css)).

### How it explains defaults
Defaults aren't explained inside the extension UI itself at first run — the explanation happens
on the external thank-you page's checkbox list (tracker blocking, social-widget removal, search-ad
filtering, filter-improvement telemetry), which doubles as an opt-in/opt-out control surface, not
just messaging.

### Popup vs. full settings
Not independently re-verified via live install this pass (would require installing the
extension); the popup's own source directory
(`Extension/src/pages/popup/`) exists separately from `options/`, consistent with AdGuard's
long-documented pattern of a compact popup (protection toggle, per-site controls, quick links) vs.
a full sidebar-nav settings app, but the specific "how it signals the relationship to a new user"
question is not confirmed from source alone — flagged as unverified rather than guessed.

### Guided tours/tooltips
None found in the extension's own source beyond the external thank-you page's one-time setup
checklist described above; no in-app tooltip/wizard system found in the `options` or `popup`
component trees.

---

## 3. Ghostery (`ghostery/ghostery-extension`)

### Post-install flow: confirmed — auto-opens a full multi-screen wizard tab
Ghostery doesn't use a literal `chrome.runtime.onInstalled` listener for this; it uses an
options-observer pattern with the same practical effect. `src/background/onboarding.js` watches
the `onboarding` option (default `false`,
[`src/store/options.js`](https://github.com/ghostery/ghostery-extension/blob/main/src/store/options.js)):
the first time the background script runs after install (when `onboarding` is still `false`), it
fires `chrome.tabs.create({ url: chrome.runtime.getURL('/pages/onboarding/index.html') })`
([`src/background/onboarding.js`](https://github.com/ghostery/ghostery-extension/blob/main/src/background/onboarding.js)).
This is the heaviest onboarding of the four in terms of number of screens: the onboarding page
(`src/pages/onboarding/index.js`) mounts a router stack of `Main → Modes → Success` (or
`Success → Modes` on Firefox if terms were already accepted)
([`index.js`](https://github.com/ghostery/ghostery-extension/blob/main/src/pages/onboarding/index.js)).

- **Main** screen: "Welcome to Ghostery" / "Setup Ghostery to get started" (Chromium) or "Enable
  Ghostery to get started" (Firefox), three feature pills (Ad-Blocking, Anti-Tracking,
  Never-Consent), a telemetry-consent explanation with links to sub-pages
  (web-trackers/addon-health/performance detail screens), a "Continue"/"Enable Ghostery" CTA, and
  — on Chromium — a visible "Uninstall Ghostery" escape hatch right there on the welcome screen
  ([`views/main.js`](https://github.com/ghostery/ghostery-extension/blob/main/src/pages/onboarding/views/main.js)).
- **Success** screen: "Setup Successful" with an SVG illustration, or — if the user picked "Zap"
  mode — a three-step numbered walkthrough ("Open a site" → "Zap ads once" → "Site stays ad-free
  every time you visit") rendered with an actual Lottie animation, plus a per-browser
  "pin the extension" instructional screenshot (different image asset for Chrome, Edge, Opera,
  Brave) and a `telemetry:ping` / `install_complete` event fired on render
  ([`views/success.js`](https://github.com/ghostery/ghostery-extension/blob/main/src/pages/onboarding/views/success.js)).

A managed-policy flag (`disableOnboarding`) and an already-accepted-terms check can suppress this
for enterprise/managed deployments
([`index.js`](https://github.com/ghostery/ghostery-extension/blob/main/src/pages/onboarding/index.js)),
but for an ordinary consumer install it fires unconditionally.

### Visual design
Uses a component library built on the `hybrids` framework with custom elements (`ui-card`,
`ui-button`, `ui-text`, `onboarding-feature`, `onboarding-step`). Design tokens
(`src/ui/styles.css`) define the Inter typeface (four weights) and a full primitive color system:
a cyan-blue "brand" scale (`--color-brand-500: #00aef0`), danger red, success green, and a gray
scale, each with 100–900 shades
([`src/ui/styles.css`](https://github.com/ghostery/ghostery-extension/blob/main/src/ui/styles.css)).
Theme is user-selectable (light/dark/system) and implemented by rewriting
`prefers-color-scheme` media-query rules live at runtime, not just a static CSS media query
([`src/ui/theme.js`](https://github.com/ghostery/ghostery-extension/blob/main/src/ui/theme.js)) —
the most sophisticated theming implementation of the four researched here.

### How it explains defaults
The onboarding wizard itself is the defaults explanation: the "Modes" screen (referenced but not
fetched in full this pass) lets a user pick a blocking mode before Ghostery actually starts
protecting, meaning Ghostery explains and asks rather than silently defaulting and explaining
after the fact.

### Popup vs. full settings
`src/pages/panel/` (toolbar popup) and `src/pages/settings/` (full options page) are separate
directories with their own component trees
([panel](https://github.com/ghostery/ghostery-extension/tree/main/src/pages/panel),
[settings](https://github.com/ghostery/ghostery-extension/tree/main/src/pages/settings)) — not
independently re-verified via live install this pass for exactly how the popup signals "there's
more in full settings" to a brand-new user; flagged as unverified rather than guessed.

### Guided tours/tooltips
The onboarding wizard itself is the guided tour (see above) — a purpose-built, multi-step,
animated walkthrough, not a lightweight tooltip layer bolted onto the main UI.

---

## 4. Privacy Badger (EFF, `EFForg/privacybadger`)

### Post-install flow: confirmed — auto-opens a tab, gated by a real (default-on) setting
`src/js/background.js` computes `isFirstRun` by comparing the stored `badgerVersion` against the
current one (no functional difference from `onInstalled`'s `reason === "install"`, just
implemented via version-diffing instead of the native event)
([`background.js` lines ~904-922](https://github.com/EFForg/privacybadger/blob/master/src/js/background.js)).
On first run it calls `showWelcomePage()`, which checks a `showIntroPage` setting — **default
`true`** — before doing `chrome.tabs.create({ url: chrome.runtime.getURL("/skin/firstRun.html") })`
([`background.js` lines ~498-530](https://github.com/EFForg/privacybadger/blob/master/src/js/background.js);
default confirmed at
[`src/js/constants.js`](https://github.com/EFForg/privacybadger/blob/master/src/js/constants.js)
line 880: `showIntroPage: true`). There's also a documented Firefox-specific workaround
(`keepBackgroundAliveForWelcomePage`) to stop the background process from being killed while the
welcome tab is still open — evidence the team has put real engineering effort into this page
staying reliable, not treating it as an afterthought.

The EFF's own 2018 blog post about a since-shipped redesign of this exact page frames the intent
directly: "Sometimes it's big visual changes like the onboarding process... deliberately
[keeping Privacy Badger] install-and-forget-simple," and that the page's three core messages are
"Learns as you browse," "Catches sneaky trackers," and "Not an ad-blocker"
([EFF: "A New Welcome to Privacy Badger and How We Got Here," April 2018](https://www.eff.org/deeplinks/2018/04/new-welcome-privacy-badger-and-how-we-got-here)).
The current `firstRun.html` source matches that framing closely.

### Visual design
`skin/firstRun.html` is a single long scrolling page (Foundation-CSS grid classes:
`grid-container`, `cell`, `grid-x`), not a multi-step wizard with "next" buttons — sections flow
top to bottom: an EFF-logo header, a "pin the extension" nudge (Chromium only) with an actual
animated GIF walkthrough and a "Stop Animation" accessibility control, a "how to disable Privacy
Badger for a site" walkthrough with a screenshot, a "try opening the popup" nudge, then feature
explainer sections ("beyond ads," "not an ad-blocker / learns as you browse"), and finally an EFF
donation ask with a direct link to `supporters.eff.org`
([`skin/firstRun.html`](https://github.com/EFForg/privacybadger/blob/master/src/skin/firstRun.html)).
Typography is Open Sans (Light/Bold) and Noto Sans; the signature Privacy Badger orange
(`#F06A0A`) is the accent/CTA color; dark mode is supported via an explicit
`@media (prefers-color-scheme: dark)` block (`color-scheme: dark`, `#222`/`#ddd` backgrounds/text)
([`skin/css/firstRun.css`](https://github.com/EFForg/privacybadger/blob/master/src/skin/css/firstRun.css)).
The full options page (`skin/options.html`) is a jQuery-UI **tabbed** single page (`#tabs` with
"Disabled sites," "General Settings," "Manage Widgets," "Tracking Domains," "Manage Data" tabs) —
a third distinct settings-navigation pattern versus AdGuard's sidebar and Ghostery's card/router
stack ([`skin/options.html`](https://github.com/EFForg/privacybadger/blob/master/src/skin/options.html)).

### How it explains defaults
Per the EFF's own public FAQ (privacybadger.org): Privacy Badger explicitly does *not* start with
a static blocklist — "nothing in the Privacy Badger code is specifically written to block ads,"
it "learns" by watching whether the same third-party host appears to track across three or more
sites before blocking it. The popup's three-state slider is explained per-color: red = "content
from this third party domain has been completely disallowed," yellow = domain kept but
third-party cookies screened out, green = "no action." ([privacybadger.org](https://privacybadger.org/)).
This "learning period" framing is baked into the first-run page too (see the three headline
messages above) — the defaults explanation and the onboarding page are the same artifact.

### Popup vs. full settings
The popup shows the per-domain three-state sliders described above; the options page (tabbed, see
above) is reached from the popup for allowlist management, general settings, widget-replacement
management, and data management. The exact click-path/signal from popup to options was not
independently re-verified via live install this pass.

### Guided tours/tooltips
The first-run page doubles as the only guided tour — it explicitly walks through pinning the
extension, disabling per-site, and opening the popup, embedded as GIF/image walkthroughs rather
than live in-page tooltips over the real UI.

---

## 5. Takeaways for Moat

**Does any of these four auto-open a full tab on install? Yes — three out of four do, and all
three are heavier than what a "minimal popup-card" framing would suggest.**

| | Auto-opens a tab on install? | How heavy |
|---|---|---|
| uBlock Origin (full) | **No** — confirmed by source absence, not silence | N/A |
| uBO Lite (uBOL) | **No** — same confirmation | N/A |
| AdGuard | **Yes** | Heaviest: local loading screen → external marketing page with cross-sell for 4+ other AdGuard products, telemetry-consent checkboxes, QR codes |
| Ghostery | **Yes** | Heavy: multi-screen router wizard (Main → Modes → Success), Lottie animation, per-browser pin-instruction screenshots, telemetry ping on completion |
| Privacy Badger | **Yes** | Moderate: single long-scroll page, no multi-step wizard, no telemetry, explicit `showIntroPage` setting a user can turn off, ships with real accessibility affordances (pause-animation control) |

The uBlock Origin family is the one data point that fully matches Moat's stated "no onboarding
tabs" README principle — and it's arguably the single most respected, most-recommended blocker in
this entire category, which undercuts any argument that a full-tab welcome page is *necessary*
for user trust or comprehension. It ships silently and lets its popup and wiki carry the
explanatory weight instead.

But three of four researched competitors — including two (AdGuard, Ghostery) that are direct,
mainstream competitors to Moat's exact positioning — do open a full tab, and none of them treat it
as a light touch. AdGuard's is a marketing funnel. Ghostery's is a multi-step wizard with
animation and per-browser screenshots. Privacy Badger's is the lightest of the three, and it's
still a full scrolling page with GIFs, a donation ask, and real engineering investment
(the Firefox keep-alive workaround) — not a five-second card.

**What this implies for the v0.11.111-in-progress branch's full options-page welcome tab**: it
would put Moat in the *majority* pattern among real competitors, not an outlier — but the
competitors doing it are using that tab for things Moat doesn't want (AdGuard: product cross-sell
and telemetry consent; Ghostery: a mode-selection decision the user must make before protection
starts). If Moat's WIP tab is scoped tightly to "here's what's on by default, here's where
settings live" with no cross-sell, no telemetry ask, and no gating of protection behind a decision
screen, it would be a lighter version of the *heaviest-precedented* pattern in the space, not an
invention of a new one — which is a defensible position, but it does contradict the literal
README text ("no onboarding tabs") on its face regardless of how light the tab's content is. That
text would need to change (or the tab would need to not auto-open, e.g., only reachable via a
popup link) for the two to stop being in tension.

Worth noting for whoever makes this call: as read on this pass, Moat's current `master`
(v0.11.110, pre-dating the v0.11.111 branch this brief describes) already has a working, shipped
version of the *lighter* option the prior review recommended —
`src/background/updateNotice.ts` tracks a `hasSeenOnboarding` flag consumed by the popup
(`src/popup/popup.ts`) to show a first-run card there, not a new tab. If the v0.11.111 branch's
full-tab welcome page is additive to that (rather than a replacement), Moat would end up doing
*both* the popup-card approach and a full-tab approach at once, which is heavier than any single
competitor researched here — none of the three that open a tab also carry a separate persistent
popup-card notice on top of it. That combination, more than the tab alone, is the thing most worth
scrutinizing against the "no nag screens" half of the README's own principle.

**One more concrete, low-risk idea drawn from this research regardless of the tab decision**:
Privacy Badger's `showIntroPage` setting — a real, persisted, user-facing "don't show this again"
toggle, not just a one-time internal flag — is worth copying independent of whether Moat's welcome
experience lives in a tab or a popup card. It's the one thing among all three tab-opening
competitors that meaningfully respects a user who doesn't want to be shown anything, without
requiring the team to abandon showing new users something the first time.

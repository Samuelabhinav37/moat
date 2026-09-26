# First-run tour: research and real measurements (2026-09-26)

Input for Moat's first-run tour (a tab opened once after install). Builds on
[competitor-onboarding-and-settings-ux-2026-09.md](competitor-onboarding-and-settings-ux-2026-09.md),
which covered uBlock Origin, uBO Lite, AdGuard, Ghostery and Privacy Badger.

## What others do

- **Pie Adblock.** Opens a multi-step tab after install. One step demos blocking on five real
  news sites in tabs (ESPN, Los Angeles Times, Yahoo, Wired, Business Insider): "Click to see how
  much better the internet is with Pie." A later step walks through pinning (puzzle piece, then
  pin) and shows an amber "Pie Adblock is not pinned to your browser" box that reacts to the real
  pin state. It also asks the user to choose Visual Mode (ads visibly vanish) or Classic Mode, and
  offers to auto-disable other ad blockers. It markets "real-time stats that show just how much
  screen space you've taken back"
  ([pie.org/features/visual-mode](https://pie.org/features/visual-mode),
  [adblockanalyst.com](https://www.adblockanalyst.com/p/honey-chrome-extension-founder-launches-new-category-of-ad-blocker)).
- **Ghostery.** Welcome tab with "Enable Ghostery", then a success page with pin instructions.
  All of its rulesets stay disabled until that click, so a user who closes the tab is unprotected
  ([superchargebrowser.com test, Aug 2026](https://www.superchargebrowser.com/library/tested-chrome-ad-blockers-manifest-v3-2026/)).
- **Adblock Plus / AdBlock.** Onboarding window after install that tells users to pin the icon
  ([ABP help](https://help.adblockplus.org/adblock-plus-help-center/how-to-download-and-install-adblock-plus)).
- **uBlock Origin Lite.** No tab. Protection is on at install.

Takeaways for Moat: show blocking on a real page, make the pin step react to the real pin state,
and never make protection wait on the tour (Ghostery's failure mode). Skip Pie's mode choice
(Moat has no modes) and its "disable other blockers" step.

## Pin detection

- `action.getUserSettings()` returns `{ isOnToolbar }` (Chrome 91+; documented on MDN for Firefox
  MV3). `action.onUserSettingsChanged` fires when the user pins or unpins (Chrome 130+). Neither
  can pin the extension; the page can only guide.
- Chrome is testing auto-pinning of new extensions in Canary (July 2026), behind a "Pin new
  extensions" toggle on chrome://extensions
  ([Android Authority](https://www.androidauthority.com/google-chrome-auto-extension-pinning-3683826/),
  [PiunikaWeb](https://piunikaweb.com/2026/07/03/google-chrome-automatic-extension-pinning/)).
  The pin step must handle "already pinned" and skip itself.

## Real before/after, measured

Chrome for Testing 154, fresh profile each run, 1280x800, same machine and network, one load
each, 26 Sep 2026. "Without" is plain Chrome, "with" is Moat 0.11.137 on its defaults. One run
each, so treat the timings as indicative. Ads and counts change daily.

| Site | Requests | Transferred | Load event | Blocked by Moat |
|---|---|---|---|---|
| weather.com | 806 → 297 | 6.3 MB → 3.6 MB | 20.1 s → 0.8 s | 27 (16 domains) |
| forbes.com | 393 → 163 | 10.5 MB → 8.0 MB | >60 s (timed out) → 5.9 s | 23 (15 domains) |
| yahoo.com | 457 → 259 | 5.5 MB → 5.4 MB | 1.1 s → 2.6 s | 28 (9 domains) |
| dailymail.co.uk | 383 → 219 | 7.7 MB → 5.2 MB | 0.6 s → 3.5 s | 12 (10 domains) |
| espn.com | 271 → 143 | 5.5 MB → 4.0 MB | 3.3 s → 3.4 s | 5 (5 domains) |

The gap between "blocked" and the drop in requests is the useful explanation of how blocking
works: each ad or tracking script Moat stops would have loaded dozens more of its own. On
weather.com, 27 blocked requests meant 509 fewer requests overall.

Visible difference: weather.com's full-width product ad at the top of the page and forbes.com's
banner under the menu are both gone with Moat on.

Blocked on weather.com included `securepubads.g.doubleclick.net`, `micro.rubiconproject.com`,
`api.lab.amplitude.com`, `mparticle.weather.com`, `js-agent.newrelic.com` and
`weather-channel.solutions.cdn.optable.co`.

**Found while measuring: the popup undercounts on ad-heavy pages.** On weather.com only 7
requests had been blocked when the page fired its load event, but 21 to 27 were blocked within
9 seconds (lazy-loaded ads, refreshing ad slots). The popup and toolbar badge refresh their count
once, at `webNavigation.onCompleted`, so they showed 8. Counting the same page's matches later
with Moat's own rules gives 27: 4 ads, 22 trackers, 1 pop-up. Fix pending: refresh when the popup
opens, and again after load, within `getMatchedRules`' call quota.

**Also found while measuring, not yet investigated:** on cnn.com, Moat's run made 3,173 requests and
3,075 of them were blocked, against 109 requests without Moat. Something on the page retries a
blocked request in a tight loop. Worth checking for CPU cost and whether a redirect-to-stub rule
would stop the loop.

## Using real sites in the tour

Pie shows other companies' sites in its onboarding. Shipping third-party screenshots inside the
extension package or store listing carries trademark and copyright questions (logos, news
photos) and store "misleading content" review risk. Options: use them with logos and photos
cropped, redraw the layout from the real capture, or keep real numbers with a neutral
illustration. **Decided 2026-09-26: ship them as captured** (the owner's call, same approach as
Pie). The JPEGs live in `src/welcome/img/`.

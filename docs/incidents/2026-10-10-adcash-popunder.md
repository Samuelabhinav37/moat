# A pop-up scam got past Moat (10 October 2026)

## Summary

While watching a football stream on streamsgate.co with Moat 0.11.273 installed, the user was
shown adblockerpremium.online, a page dressed as the Chrome Web Store that pushes the "Ad Blocker
Premium" extension. The page came from the Adcash ad network, loaded inside the stream's player
frame. Moat blocked Adcash's usual loader, but Adcash fell back to a throwaway domain that no list
knew, and the scam domain wasn't on any list either.

Fixed the same day: the scam page and its tracker are blocked (live fix, then 0.11.274), Adcash's
fallback requests are blocked on any domain by what they contain rather than where they go, and
the build now fails if Chrome would silently drop one of Moat's regex rules.

## How the ad reached the user

1. streamsgate.co embeds a player from embedme.st, which embeds another from xstream.st. Ads run
   in that innermost frame, two sites away from the page the user opened.
2. The xstream.st frame loads Adcash (account 7176486) through
   `adexchangerapid.com/script/suurl5.php`. **Moat blocked this**, through AdGuard's
   `/suurl5.php` rule.
3. Adcash expects to be blocked. It falls back to a random domain made for the purpose
   (`bzynecajutcjj.website`, with assets on `dfnahgnmooktg.online`) and asks there for the ad. The
   request hides its usual fields (`cbiframe=`, `chmob=`, `cbHeight=`) base64-encoded under one
   random 24-character parameter, in a shuffled order. AdGuard's rule for the plain form
   (`&stamat=*&chmob=`) caught 3 of 8 requests. **5 of 8 went through.**
4. Adcash served a pop-under pointing to adblockerpremium.online. That page reports the visitor to
   `krilovane.info` and links to the extension's store listing. Neither domain was on any bundled,
   live or upstream list.

## What Moat did and didn't do

| Layer | Result |
| --- | --- |
| Network lists (AdGuard, HaGeZi, Peter Lowe, oisd) | Cut the page's third-party hosts from 264 to 18 and blocked Adcash's main loader. Missed the fallback domain and the scam domains, which were days old at most. |
| Pop-up firewall (`mainWorldGuard.ts`) | Held in every automated run: no pop-up opened, including on the released 0.11.273 package with clicks on the player's real play and volume buttons. Without Moat, the same clicks opened Adcash pop-ups (`browserpro.online ... network=adcash`). |
| Redirect guard (`popupGuard.ts`, redirect-domain block rules) | Domain based, so it couldn't stop a domain it didn't know. |
| Tab-under (a frame sending the current tab to an ad) | **Not guarded.** Moat watches `window.open` and scripted link clicks, not a frame navigating the top window. |

We couldn't reproduce the pop-up itself with Moat on. The two paths that fit are a click the
firewall judged real (a pop-up after the user pressed an actual player control, which our
automated clicks didn't recreate) or a tab-under, which nothing in Moat looks at. Whether a new
tab opened or the user's own tab changed would tell them apart.

## Patterns to learn from

1. **Blocking the loader isn't the end.** Pop-under networks plan for ad blockers: when the
   loader fails, they retry on fresh random domains. A domain list is always behind them. Rules
   should target what the requests carry (fixed field names, payload shapes) as well as where
   they go.
2. **Ads live in nested third-party frames.** Here the ad code ran two embeds deep. Tests that
   only watch the top frame see one request and miss everything; the probe now records requests
   from every frame and clicks inside each.
3. **New scam domains outrun every list.** The lander and its tracker were on none of AdGuard,
   HaGeZi, Peter Lowe or oisd. Moat's own scam list and the live quick-fix channel are what closed
   it within the hour.
4. **Chrome drops what it can't run, silently.** The first version of the Adcash rule used
   `{24}`-style counts. Chrome's regex engine refused it (`memoryLimitExceeded`) and would have
   ignored it with no error. `npm run check:chrome-load` now asks Chrome about every bundled regex
   (273 at the time, all fine) and fails the build on any it would drop.
5. **Hand-edited live files must match the generator byte for byte.** Writing
   `live/redirect-domains.json` with spaces after commas made CI's regenerated copy differ from the
   signed one, and CI stopped. Write it the way `filters:update` does (compact JSON).

## Changes

- `live/quick-fixes.json`, `rules/known-popup-scam-domains.json`: block adblockerpremium.online,
  krilovane.info and the two Adcash fallback domains. adblockerpremium.com, the extension's own
  site, is left alone: the redirect list blocks whole pages, and Moat shouldn't block a competing
  ad blocker's home page.
- `scripts/lib/popunderNetworkRules.mjs`: one rule matching Adcash's fallback requests on any
  domain by the three base64 spellings of `cbiframe=`, third-party only. The live channel carries
  the same three as URL filters.
- `src/background/blockedPage.ts`: pages stopped by the pop-up and redirect lists are named "Pop-up
  ads" instead of "list not known".
- `scripts/check-chrome-load.mjs`: fails on any bundled regex Chrome won't run.

## Still open

- **Tab-under protection.** Detect a cross-site frame navigating the top window right after a
  click, and send the tab back. Needs care: sign-in and payment flows navigate the top window from
  frames legitimately.
- **Other pop-under networks.** PropellerAds/Monetag, HilltopAds, Clickadu and Adsterra use the
  same retry-on-a-new-domain approach. Each needs the same kind of payload signature, found the same
  way: load a streaming site without Moat, capture what the fallback requests carry.
- `ann.cdn-lab.shop/v1/channel` still loads in that player. Not identified, left alone so the
  stream keeps working.

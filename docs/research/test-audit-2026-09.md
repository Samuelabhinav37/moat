# Test audit and competitor benchmark (2026-09-26)

Moat 0.11.140 against uBlock Origin Lite 2026.920.1710, AdGuard 5.5.2.50, Ghostery 10.6.4 and
Adblock Plus 4.44.1, plus a run with no blocker. Every extension was the real package from the
Chrome Web Store, loaded into Chrome for Testing 154 with a fresh profile and **its own defaults**
(Ghostery's onboarding was accepted, since it blocks nothing until then). Moat was on Balanced.
Headless, one machine, one network, US location, one run per site. Timings are indicative.

## 1. Blocking coverage: d3ward's host list

d3ward's ad-block test page is archived, so its host list
(`src/data/adblock_data.json`, 131 hosts) was requested directly from a neutral page. A host
counts as blocked if Chrome reported `ERR_BLOCKED_BY_CLIENT` for it.

| Category | Moat | uBO Lite | Ghostery | AdGuard | Adblock Plus |
|---|---|---|---|---|---|
| Ads (20) | 20 | 18 | 18 | 13 | 13 |
| Analytics (30) | 30 | 30 | 30 | 0 | 0 |
| Error trackers (6) | 6 | 6 | 6 | 0 | 0 |
| Social trackers (20) | 20 | 13 | 15 | 2 | 2 |
| Mixed (20) | 19 | 8 | 12 | 2 | 2 |
| Phone-maker telemetry (35) | 35 | 17 | 24 | 4 | 4 |
| **Total (131)** | **130** | 92 | 105 | 21 | 21 |

Moat's one miss: `udc.yahoo.com`. AdGuard and Adblock Plus score low because only their ad filter
is on by default; their tracking protection is opt-in.

## 2. Eight ad-heavy sites

weather.com, forbes.com, yahoo.com, dailymail.co.uk, cnn.com, espn.com, independent.co.uk,
speedtest.net. Each page: load, 6 s settle, scroll 4 screens, measure.

| | None | Moat | uBO Lite | Ghostery | AdGuard | Adblock Plus |
|---|---|---|---|---|---|---|
| Requests (8 sites) | 3,327 | 1,415 | 1,405 | 1,424 | 2,189 | 2,145 |
| Downloaded | 76 MB | 53 MB | 51 MB | 61 MB | 62 MB | 63 MB |
| Visible ad slots left* | 122 | **4** | 12 | **4** | 14 | 34 |
| First paint (median) | 1,064 ms | 816 ms | 780 ms | 920 ms | 948 ms | 892 ms |
| Main content (LCP, median) | 1,640 ms | 1,100 ms | 1,072 ms | 1,144 ms | 1,112 ms | 1,104 ms |
| Page main-thread work (sum) | 76.8 s | 35.6 s | **32.2 s** | 36.3 s | 50.0 s | 46.2 s |
| Background worker memory | – | 9 MB | **1 MB** | 17 MB | 140 MB | 104 MB |
| Startup (worker ready) | – | 3.1 s | **1.1 s** | 1.2 s | 3.0 s | 8.5 s |
| Cloudflare Turnstile test key | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| cnn.com blocked requests in 15 s | 0 | 10 | 6 | 10 | 7 | 4 |

\* Visible third-party iframes at least 100×50, plus visible elements whose id/class looks like an
ad container (`ad`, `ads`, `advert`, `sponsor`, `adslot`, ...). A proxy, not a manual count. Every
top blocker left the same 3 boxes and 1 frame on yahoo.com.

Per site (ad boxes left / ad frames left / requests blocked):

| Site | None | Moat | uBO Lite | AdGuard | Ghostery | ABP |
|---|---|---|---|---|---|---|
| weather.com | 11/0/0 | 0/0/23 | 0/0/22 | 10/0/13 | 0/0/22 | 2/0/11 |
| forbes.com | 5/1/0 | 0/0/20 | 0/0/23 | 0/0/21 | 0/0/24 | 0/0/24 |
| yahoo.com | 23/4/0 | 3/1/49 | 3/1/30 | 3/1/14 | 3/1/36 | 14/0/61 |
| dailymail.co.uk | 39/1/0 | 0/0/12 | 0/0/9 | 0/0/4 | 0/0/7 | 0/0/3 |
| cnn.com | 12/0/0 | 0/0/10 | 2/0/6 | 0/0/7 | 0/0/10 | 12/0/4 |
| espn.com | 9/1/0 | 0/0/5 | 6/0/24 | 0/0/4 | 0/0/4 | 0/0/8 |
| independent.co.uk | 3/0/0 | 0/0/24 | 0/0/20 | 0/0/19 | 0/0/22 | 0/1/26 |
| speedtest.net | 7/6/0 | 0/0/5 | 0/0/6 | 0/0/7 | 0/0/5 | 1/4/14 |

Cookie banners: none of the tested sites showed one to a US visitor, even with no blocker, so this
run says nothing about cookie handling. It needs a run from an EU network.

## 3. Stress tests (Moat only)

Local pages under many hostnames, so every run is repeatable.

| Test | Result |
|---|---|
| 25 tabs at once | Ads hidden in 25/25, no ad request leaked. Worker heap 3.6 → 28 MB (hiding index loaded). |
| 150 navigations in one tab | No page errors, worker alive, last page hidden correctly, heap 4.6 → 28.8 MB. |
| 100 tabs opened and closed | Heap 3.7 → 13.6 → 14.9 → 24.8 → 18.6 MB. No steady climb. |
| 60 rapid setting changes + 20 pause toggles | Final state exactly the last write; cookie script registration matched. |
| Page adding 5,000 elements | Late ads hidden 100/100, **but main-thread work 1.19 s vs 0.13 s without Moat** (see 4.1). |
| 30 page loads in a few minutes | **Popup and badge showed 0 on a page with 2 blocked requests** (see 4.2). |
| 2,000 "always block" domains | **Only 1,000 rules created; domain 2,000 not blocked; adding took 100 s** (see 4.3). |

## 4. Findings, by severity

### 4.1 Nine `:has()` selectors make every DOM change expensive (high)

The generic "high" selector set is injected on every page at commit time: 1,075 selectors, 851 of
them attribute-substring matches, 59 with sibling combinators, 9 with `:has()`. On a page that keeps
adding content, Chrome re-matches them on every change. Measured on the 5,000-element page:

| Variant | Main-thread | Style recalc |
|---|---|---|
| No blocker | 0.13 s | 0.01 s |
| Moat | 1.19 s | 0.82 s |
| Moat without the 9 `:has()` selectors | 0.36 s | 0.10 s |
| … and without sibling combinators | 0.27 s | 0.03 s |
| Moat without the generic-high set | 0.27 s | 0.01 s |

The nine target a rare Google AMP ad structure (`amp-ad-exit + div…:has(…amp-pixel…)`). Removing
them from the always-on sheet cuts the restyle cost by ~88%. Most likely cause of the reported
slowness on LinkedIn's feed (infinite scroll = constant DOM changes). The in-page surveyor script
itself costs almost nothing (removing it changed nothing).

### 4.2 The popup count drops to 0 once `getMatchedRules` is rate-limited (high)

Chrome allows 20 `getMatchedRules` calls per 10 minutes outside a user gesture. Moat reads once at
load and once 8 s later on the active tab (0.11.139), so ~10 page loads in 10 minutes use it up.
After that the read fails, and because the per-tab numbers were reset on navigation, the popup and
badge show 0. Fix direction: count blocks per tab from `webRequest.onErrorOccurred`
(`net::ERR_BLOCKED_BY_CLIENT`, no quota, real time) and use `getMatchedRules` only to split them
into ads/trackers/pop-ups when a call is available.

### 4.3 Custom block/allow lists silently stop at 1,000 domains (medium)

`MAX_CUSTOM_RULES_PER_LIST = 1000`, one rule per domain, extras dropped without a message; every
add rewrites all dynamic rules (100 s for 2,000 adds). Fix direction: one rule can list many domains
(`condition.requestDomains`), so pack each list into a few rules, and tell the user if a limit is
ever hit.

### 4.4 Generic hiding lands after the first paint on cached pages and cold starts (medium)

From the smoke test: a reserved ad slot is visible for 5–8 of the first 30 frames on a repeat visit,
8–10 after an idle worker restart. Token-matched generic selectors are resolved by the worker
after the page is parsed. Fix direction: cache the selectors resolved for each site and inject them
with the commit-time stylesheet on the next visit.

### 4.5 Slower startup and more memory than uBO Lite (low)

Worker ready in 3.1 s vs 1.1 s, 9 MB vs 1 MB after the run (28 MB with the hiding index loaded in
the stress tests). Moat enables all 25 rulesets in the manifest and trims to the preset at startup,
where uBO Lite enables 6. Worth measuring whether enabling only the preset's rulesets in the
manifest and loading the cosmetic index lazily per site closes the gap.

### 4.6 Test coverage gaps (low)

117 source modules, 111 test files; 37 modules have no test of their own. Largest: the background
message router (`background/index.ts`, 600 lines; since split into `messageRouter.ts` with its
own tests) and the in-page scripts (page-world guard,
bridge, cookie rejector, element picker, YouTube dimmer, feed scanner). The popup, options and
welcome pages have render tests, and `npm run smoke` now covers the in-page scripts end to end.

## 5. Where Moat stands

- **Ahead:** blocking coverage (130/131 vs 105 for the next best at defaults), fewest ads left on
  real pages (tied with Ghostery), trackers blocked by default where AdGuard and ABP need opt-in,
  pop-up firewall and first-party retry-loop stubs no competitor tested here has.
- **Level:** page speed (first paint and LCP within a few percent of uBO Lite), Cloudflare checks.
- **Behind:** content-heavy pages (4.1), count accuracy under heavy browsing (4.2), startup time and
  idle memory vs uBO Lite (4.5), and the custom-list cap (4.3).

## 6. After the fixes (0.11.145)

Same harness, rerun on 0.11.145 against uBO Lite only (the other packages were unchanged). One run
per site, so page timings move by a few hundred milliseconds between runs.

| | Moat 0.11.140 | Moat 0.11.145 | uBO Lite (rerun) |
|---|---|---|---|
| d3ward hosts blocked | 130/131 | 130/131 | 92/131 |
| Visible ad slots left (8 sites) | 4 | 4 | 12 |
| Requests (8 sites) | 1,415 | 1,372 | 1,404 |
| Page main-thread work (sum) | 35.6 s | 40.3 s | 39.9 s |
| Cloudflare Turnstile | 3/3 | 3/3 | 3/3 |
| Background worker memory | 9 MB | 9 MB | 1 MB |
| Startup (worker ready) | 3.1 s | 3.6 s | 1.2 s |

Main-thread work rose for both blockers, so that is the sites, not Moat. Median LCP in this run was
1.9 s for Moat and 1.3 s for uBO Lite, set by weather.com and espn.com, where the audit run had
them level. It needs repeated runs before it means anything.

Stress tests on 0.11.145:

| Test | 0.11.140 | 0.11.145 |
|---|---|---|
| Page adding 5,000 elements: main-thread / restyle | 1.19 s / 0.82 s | **0.38 s / 0.11 s** |
| Popup and badge after 30 page loads (2 blocked) | 0 | **2** |
| 2,000 "always block" domains | 1,000 rules, last domain open, 100 s | **4 rules, last domain blocked, 54 s** |
| 25 tabs, 150 navigations, 100-tab churn, settings thrash | pass | pass |

Repeat-visit ad flash (smoke test): 5–8 frames before, 1–2 after.

Still open:
- **Startup.** Enabling only the Balanced rulesets in the manifest (0.11.144) made the final
  ruleset set ready sooner (3.96 s → 3.53 s in the smoke test), but the worker-ready time did not
  move. The remaining gap is Chrome compiling the enabled rules, roughly 3× what uBO Lite enables.
- **Cold-start flash** stays at about 8 frames: with an idle worker nothing can add the cached
  selectors before the first paint. Fixing it needs a style the page itself carries, which makes
  Moat easier for sites to detect.
- **Idle memory** 9 MB vs 1 MB, unchanged.
- **4.6** The message router now has its own module and tests (`messageRouter.test.ts`).

## Reproducing

The harness lives in `scripts/benchmark/` (see its README). It is not part of CI: it loads live
sites and takes about 25 minutes.

```
node scripts/benchmark/fetch-competitors.mjs   # Web Store packages into .cache/benchmark/ext
npm run build
node scripts/benchmark/bench.mjs               # coverage, 8 sites, startup, memory
node scripts/benchmark/stress.mjs              # Moat-only stress tests on local pages
```

Competitor packages come from
`https://clients2.google.com/service/update2/crx?response=redirect&prodversion=154.0&acceptformat=crx3&x=id%3D<id>%26uc`
(strip the CRX3 header, unzip, load unpacked). The repeatable in-page checks run in CI as
`npm run smoke`.

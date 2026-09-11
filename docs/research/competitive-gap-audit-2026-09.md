# Competitive re-scan: Moat vs. uBlock Origin, AdGuard, Brave Shields, Ghostery, Privacy Badger, DuckDuckGo Privacy Essentials (September 2026)

A follow-up pass to [`competitive-gap-audit.md`](competitive-gap-audit.md) (2026-08-25/26) and
[`feature-expansion-survey.md`](feature-expansion-survey.md) (2026-08-25), both of which are now
fully resolved — every ranked item in the first is done or explicitly declined; every candidate in
the second is shipped, declined, or out of scope. This doc does **not** re-litigate either: it asks
only what changed in the roughly ten days between that pass and now (2026-09-05), and whether any
of the prior "confirmed correctly out of scope" verdicts should be revisited given new developments.
Research only, no code changes — matching how both prior docs worked.

**Sources**: live web search and direct fetches against each competitor's own current official
docs/changelogs/blogs (September 2026), Google's own Chrome for Developers documentation, Mozilla's
Bugzilla, and this session's own re-reading of Moat's current `CHANGELOG.md`, `README.md`,
`src/types.ts`, `rules/dnr/manifest.json`, `src/shared/filterPresets.ts` (moved from
`src/options/` since the original audit — noted in v0.11.23's changelog entry), and
`src/shared/matchedRuleCategories.ts`. Verified in-repo rather than trusted from the old doc's
descriptions, per this pass's brief.

## 0. Moat's own current state (verified live, not assumed from the old doc)

- **v0.11.46**, 11 bundled filter-list rulesets (`rules/dnr/manifest.json`): 2 AdGuard Base filter
  shards (ads), 3 AdGuard Tracking Protection shards + URL Tracking (trackers), Popups, 4 security
  lists (malicious-urls/phishing-urls ×4/scam/badware), 3 annoyance lists (social-widgets,
  cookie-notices, other-annoyances), plus Moat's own first-party GPC-header, URL-tracking-gap, and
  tracker-coverage-gap rulesets — matching README's "~271,000 rules, 11 lists" framing exactly.
- Every item the original audit shipped is present in `Settings`/`DEFAULT_SETTINGS`
  (`src/types.ts`): `fingerprintRotatePerSession` (opt-in per-session noise, item g),
  `leakedPasswordCheck` (opt-in HIBP check), `cookieBannerAutoReject`, `cnameUncloaking`,
  `syncEnabled`, `aggressiveFeedAdRemoval`, `grayscaleUnblockableAds` — none of this is new since
  the last pass, just confirmed still accurate.
- Since the original audit closed (v0.11.15), Moat shipped six more releases, all fixes/hardening,
  not new competitive-facing features: v0.11.16 (popup UI revert), v0.11.17–19 (visual polish,
  budget diagnostics), v0.11.36 (postMessage security hardening), v0.11.40–41 (Trackers tab,
  visual polish), v0.11.42–46 (popup CSS fix, anti-fingerprinting-of-Moat-itself hardening,
  `web_accessible_resources` fixes, zip-file fix, settings-cache perf). None of these change any
  row of the comparison table below relative to the original audit — they're bug fixes and
  polish, not new capabilities to re-compare against competitors.

## 1. Feature-by-feature comparison (updated)

| | Moat | uBlock Origin | AdGuard (extension) | Brave Shields | Ghostery | Privacy Badger | DuckDuckGo Privacy Essentials |
|---|---|---|---|---|---|---|---|
| Network blocking | DNR static rules (~271k, 11 AdGuard lists) | **Full MV2 build now completely gone from the Chrome Web Store as of Aug 31, 2026** ([Chrome for Developers MV2 timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline); [chromeunboxed](https://chromeunboxed.com/manifest-v2-is-officially-dead-as-the-chrome-web-store-permanently-purges-legacy-extensions/)); Chrome users are now on uBO Lite (DNR) full stop; Firefox keeps the full MV2 build | Fully MV3-native (unchanged; migrated Sept 2024, well before either audit) | Browser-engine level; Rust `adblock-rust` engine rewritten onto FlatBuffers, cutting the engine's own memory footprint ~75% (~45MB) ([Brave: adblock engine memory reduction](https://brave.com/privacy-updates/36-adblock-memory-reduction/)) — a performance change, not a coverage change | TrackerDB + crowdsourced discovery (unchanged) | Behavioral learning, no filter lists (unchanged) | Tracker Radar + Smarter Encryption (unchanged) |
| Cosmetic filtering | Domain-bucketed `<style>` injection, element picker | Full procedural filters on Firefox; Lite unaffected by the MV2 purge above since it was already Lite-only on Chrome | Full (unchanged) | Present (unchanged) | Present (unchanged) | None (unchanged, by EFF's own framing) | Minimal (unchanged) |
| Anti-fingerprinting | Real API-level noise, deterministic per-install + opt-in per-session rotation | None — declined scope (unchanged) | Script/domain-blocking only (unchanged) | Continues shipping WebGL vendor/renderer de-identification and extension-list noise as of v1.93 ([Brave fingerprinting protections wiki](https://github.com/brave/brave-browser/wiki/Fingerprinting-Protections)); no new mode since the Strict-mode sunset the original audit already covered | Not a focus (unchanged) | N/A (unchanged) | Not a focus (unchanged) |
| Consent-banner handling | Consent-O-Matic interpreter, auto-reject | Requires manual subscription (unchanged) | Built-in Cookie Notices filter (unchanged) | Present via filter lists (unchanged) | Never-Consent (unchanged) | None (unchanged) | Built-in (`autoconsent` library bumped to v16.23.0 in DDG's own 2026.8.24 release — a dependency bump, not a new capability) |
| Transparency/attribution UX | Popup "By company" list + Settings → Trackers per-company detail (shipped v0.11.40, after the original audit closed) | Raw Logger, Firefox-only (unchanged) | Filtering log, MV3-degraded (unchanged) | Icon + block count (unchanged) | Full Tracker Panel; **Trackers Preview on search-results pages had a real bug September 3, 2026** (broken by a search-engine link-format change, since fixed — [Ghostery changelog](https://www.ghostery.com/changelog)) — a maintenance blip, not a capability change | Three-state slider (unchanged) | Letter grade (unchanged) |
| Portability/sync | Export/import + opt-in sync (unchanged) | Browser-account sync only (unchanged) | JSON export/import (unchanged) | N/A (unchanged) | N/A (unchanged) | N/A (unchanged) | N/A (unchanged) |
| Extras beyond blocking | Leaked-password check, CNAME uncloaking, GPC header (unchanged) | None (unchanged) | Annoyances suite, ecosystem cross-sell (unchanged) | Phishing/malware warnings, HTTPS upgrade (unchanged) | "Your Web, Lately" quarterly tracker-exposure recap (new, Aug 2026) and a "Clear Browsing Data" panel replacing the narrower "Clear Cookies" action ([Ghostery changelog](https://www.ghostery.com/changelog)) — both presentation/UX, not new blocking capability | GPC/DNT (unchanged) | Email Protection, GPC, Smarter Encryption, paid Privacy Pro — now explicitly a 3-in-1 bundle (VPN + Personal Information Removal scanning 50+ data-broker sites + identity-theft restoration), still $9.99/mo, US-only ([DuckDuckGo Help: Personal Information Removal coverage](https://duckduckgo.com/duckduckgo-help-pages/privacy-pro/personal-information-removal/list-of-supported-data-brokers)) |
| Onboarding philosophy | No nag screens (unchanged) | Minimal (unchanged) | No hard paywall (unchanged) | Zero-config (unchanged) | Tracker Panel is the report (unchanged) | Redesigned welcome page (June 2026, `2026.6.16`) with clearer per-site disable instructions and better screen-reader support — accessibility polish, not a philosophy change | Grade badge (unchanged) |
| Monetization | Free, no premium tier, no telemetry | Free (unchanged) | Free extension, paid ecosystem apps (unchanged) | Free; separate paid VPN (unchanged) | Free core extension confirmed still free — Ghostery Search (a *separate* private-search product, not the extension) moved to closed beta June 1, 2026 specifically to manage hosting costs; explicitly does not touch the ad-blocker/tracker-blocker extension's free tier ([Ghostery: Search closed beta](https://www.ghostery.com/blog/ghostery-private-search-closed-beta)) | Free (unchanged) | Paid Privacy Pro bundle (unchanged in shape; still $9.99/mo per DDG's own help pages) |

## 2. What's genuinely new context (not a Moat-vs-competitor row, but shapes how to read the table)

- **Full uBlock Origin is now completely gone from the Chrome Web Store, permanently**, not just
  unlisted for new installs the way the original audit's "Chrome gets Lite" framing implied.
  Google's own Chrome for Developers Manifest V2 deprecation timeline confirms the sequence
  precisely: Chrome 138 (~June 2025) was "the final Chrome version supporting Manifest V2
  extensions" for general users; "with Chrome 138 all users on all channels of Chrome now have
  Manifest V2 extensions disabled" and can no longer re-enable them; and "August 31, 2026: all
  remaining Manifest V2 extensions are removed from the Chrome Web Store" outright — the listing
  itself is gone, not just inert. ([Chrome for Developers: MV2 deprecation timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline))
  Independent reporting from the same week confirms the practical effect: an MV2 extension already
  installed on an old Chrome profile is now permanently frozen (no updates, ever, through the Web
  Store), and a fresh install or reinstall has no path to it at all — "if an MV2 extension is
  disabled or uninstalled ... there is no way to retrieve it from official Google repositories."
  ([chromeunboxed](https://chromeunboxed.com/manifest-v2-is-officially-dead-as-the-chrome-web-store-permanently-purges-legacy-extensions/))
  This is a genuinely new fact, not a restatement — the original audit's own comparison row still
  described uBO as "Full MV2 power on Firefox only; Chrome gets 'Lite'" as if Chrome MV2 uBO were
  merely diminished; as of this pass it no longer exists as an installable, updatable option on
  Chrome at all, on any channel, for any user. AdGuard confirms the same purge hit its own legacy
  MV2 listing on the same date, though AdGuard had already fully migrated to MV3 back in 2024, so
  this cost it nothing functionally. ([AdGuard blog, tag: adguard-news](https://adguard.com/en/blog/tag/adguard-news.html))
- **Firefox has quietly, experimentally shipped Brave's own `adblock-rust` engine inside Firefox
  itself** (Bugzilla Bug 2013888, "Add a prototype rich content blocking engine," landed around
  Firefox 149 / March 2026), disabled by default with no UI and no bundled filter lists, but
  confirmed compatible with uBlock-Origin-style filter-list syntax and supporting both network
  blocking and cosmetic filtering. ([privacyguides.org](https://www.privacyguides.org/news/2026/04/24/firefox-quietly-adds-braves-rust-based-adblocker/);
  [itsfoss.com](https://itsfoss.com/news/firefox-ships-brave-adblock-engine/))
  Framed by Mozilla's own bug title and the reporting around it as an experiment toward
  strengthening Firefox's built-in Enhanced Tracking Protection, not (yet) a general-purpose
  ad-blocker replacement — inert today, but a real signal that a second major browser vendor is
  testing native, in-engine ad/tracker blocking, the same direction Brave already committed to.
  Nothing for Moat to react to today (an off-by-default, UI-less prototype changes nothing about
  what a real Firefox user experiences), but worth a line in a future pass if Mozilla ever turns
  it on.
- **A new-ish "MV3-era" competitor surfaced in this pass's search results that's worth naming and
  explicitly declining to add as a peer**: Stands AdBlocker (`standsapp.org`), which markets itself
  as "100% Free with No Paywalls ... no forced acceptable ads program" and privacy-by-design.
  Independent 2026 reporting is directly contradictory to that framing: one review cites "a
  February 2026 security report [that] identified Stands among extensions funneling user data to
  market analytics firms," and separately describes its own Chrome Web Store listing as internally
  contradictory — "the top privacy module claims the developer does not collect data, but further
  down it explicitly states that Stands collects visited websites, search engine results,
  clickstream data, and viewed content." ([standsapp.org: chrome-adblocker](https://www.standsapp.org/chrome-adblocker/);
  secondary reporting via search, original report not independently re-verified by this pass — see
  caveat below)
  **Caveat on this one claim**: the "funneling user data" characterization traces to a search
  summary of a named independent researcher's report, not a report this pass fetched and read
  directly — flagged as lower-confidence than everything else in this doc, which is all
  first-party-sourced. Worth a follow-up fetch of the original report before repeating the claim
  anywhere more prominent than this footnote. What's solid regardless (from Stands' own listing
  copy, per the secondary sources above): its own Chrome Web Store description reads as
  self-contradictory on data collection. Not recommended as a new row in the comparison table —
  it's a smaller, less-established product than the six already researched, and the point worth
  taking from it is contrast, not competition: it's a fresh, concrete example of exactly the "free
  ad blocker that isn't what it claims" pattern Moat's zero-telemetry, no-account, no-server
  positioning already stands against. No action needed beyond noting it exists.
- **Eyeo (Adblock Plus/AdBlock's parent) published a 2026 ad-blocking report** stating 96% of its
  users have Acceptable Ads enabled (up from 94% in 2023), and that Adblock Plus "maintained a
  perfect 100 out of 100 on Adblock Tester" post-MV3-migration. ([eyeo 2026 ad-blocking report PDF](https://eyeo.com/wp-content/uploads/2026/05/eyeo_2026-ad-blocking-report.pdf)
  — dated May 2026, so technically prior to the original audit's own August 2026 cutoff, but not
  cited there; included here since it's fresh supporting data for an already-shipped
  differentiation point, not a new verdict) This is a restatement-with-fresher-numbers of the
  original audit's Acceptable-Ads finding (§2 there, citing a 2026 NYU study), not new territory —
  flagged here for completeness, explicitly not counted as a "new" finding in §5 below.

## 3. Ranked opportunities surfaced this pass (not yet built)

Given how little materially changed in ten days, this list is short and low-stakes compared to the
original audit's. Nothing here is urgent; nothing here requires new engineering.

### (a) README/positioning: note the Chrome MV2 purge as context for "why Moat"
Moat's README doesn't currently mention Manifest V3 or the MV2 phase-out at all — it states Moat
runs on MV3 as a fact, without framing why that matters right now. The Chrome Web Store's complete,
permanent removal of full uBlock Origin (§2 above) is a concrete, dated, easily-verified moment
(Aug 31, 2026) where a large number of Chrome users lost their existing ad blocker outright, not
just its update channel. A one- or two-sentence addition to the README's intro or "What it does"
section — something like "built for Manifest V3 from day one, not a stripped-down Lite port" —
would be accurate, timely, and costs nothing to verify. Purely a documentation/messaging
opportunity, not a feature.

**Status: done, same commit as this doc (`3e48a6f`).** The suggested sentence landed in the
README's intro verbatim: "built for Manifest V3 from day one, not a stripped-down Lite port."
This status line was left stale when the doc was first written; corrected 2026-09-11.

### (b) Positioning: make the "we don't sell data" stance more explicit
The Stands AdBlocker contrast (§2 above) is a concrete, current example of "free ad blocker,
private-sounding marketing, browsing-data monetization underneath" — exactly the failure mode
Moat's zero-telemetry architecture already avoids by construction (`PRIVACY.md`). The original
audit's §2 already flagged this general positioning gap re: Acceptable Ads/paid allowlisting;
this pass's finding is a fresh, dated example of the *same* underlying concern in a different
shape (data-selling rather than paid ad-allowlisting) that could sharpen the same messaging
opportunity rather than open a new one. Given the confidence caveat on the Stands claim itself
(§2), this is worth folding into whatever eventually happens with opportunity (a) from the
original audit's README pass, not acting on in isolation.

**Status: done, same commit as this doc (`3e48a6f`).** The README intro now also reads "nothing
to sell," sharpening the data-selling contrast alongside (a)'s MV3 line. This status line was
left stale when the doc was first written; corrected 2026-09-11.

Nothing else surfaced this pass rose to the level of a concrete, actionable opportunity. This is
itself the expected outcome of a ten-day re-scan following a thorough audit — most of what changed
industry-wide (the MV2 purge, Brave's memory optimization, Ghostery's search-product beta, minor
version bumps across the board) is context or competitor-internal engineering, not a gap in Moat's
own feature set.

## 4. Confirmed correctly out of scope (re-checked this pass, not re-litigated from scratch)

Each item below was re-checked on its own merits against current sources, per this pass's brief —
not assumed unchanged. All still hold.

- **uBlock Origin's dynamic-filtering "firewall matrix"** — still declined on philosophy grounds,
  unchanged. Notable context shift, not a reason to revisit the verdict: with full uBO now gone
  from Chrome entirely (§2), this feature is now unavailable to any Chrome user at all (Lite has
  no equivalent), which if anything *widens* the gap between "what uBO used to offer on Chrome"
  and "what's available now" — but Moat's own reason for declining (deciding nothing for the user
  by default) was never about matching uBO's Chrome availability, so the verdict is unaffected.
- **Ghostery's `fetch`-monkeypatching** — no changes found in Ghostery's own changelog this pass
  ([ghostery.com/changelog](https://www.ghostery.com/changelog)); verdict unchanged.
- **HTTPS/TLS interception** — no relevant developments found; still out of scope for a browser
  extension by construction, unchanged.
- **VPN, network-wide DNS blocking, email tracker protection** — DuckDuckGo's Privacy Pro bundle
  is confirmed still active and, if anything, more explicitly framed as a 3-in-1 bundle (VPN +
  Personal Information Removal + identity-theft restoration) than the original audit's own
  description ([DuckDuckGo Help: Personal Information Removal](https://duckduckgo.com/duckduckgo-help-pages/privacy-pro/personal-information-removal/list-of-supported-data-brokers)),
  still $9.99/mo, still requiring server-side infrastructure Moat's zero-server model rules out.
  Verdict unchanged.
- **Multi-account containers** — actively re-verified this pass, not assumed: found and checked a
  third-party attempt at a Chrome port
  ([savannahar68/multi-account-containers-chrome](https://github.com/savannahar68/multi-account-containers-chrome)),
  whose own README states the core blocker plainly — "there's no api like contextualIdentities in
  chrome, so thinking ways of implementing cookie factory" — i.e. it has *not* solved real
  per-container cookie isolation, sits at 15 stars/2 forks/6 commits, and reads as stalled, not
  shipped. This confirms rather than merely repeats the original verdict: Chrome still has no path
  to real container-style isolation, tried by a third party and not achieved. Firefox's own
  first-party Multi-Account Containers extension continues to be actively maintained (updates as
  recently as July 2026, per its GitHub activity). Verdict unchanged.
- **Paid/premium tier, Acceptable-Ads-style allowlisting** — unchanged in shape; eyeo's own fresh
  2026 numbers (96% Acceptable-Ads opt-in, up from 94%) if anything reinforce rather than
  contradict the original concern. Verdict unchanged.
- **Font-enumeration fingerprinting resistance** — Brave's own fingerprinting-protections wiki
  shows continued investment in adjacent areas (WebGL vendor/renderer de-identification, extension
  fingerprint noise, as of v1.93) but nothing changing the specific font-enumeration gap the
  original audit identified as a hard architectural limit for an extension (no interceptable JS
  API the way canvas/audio reads have one). Verdict unchanged.
- **Instagram Stories ads** — no new information surfaced this pass; not re-investigated live
  (would require the same live-browser check the original audit did, out of scope for a
  desk-research pass). Verdict provisionally unchanged, flagged as not independently re-verified
  this time.
- **Decentraleyes-style local CDN mirroring** — Decentraleyes itself is confirmed still at v3.0.0
  (November 2024), no 2026 activity found; no competitor among the six researched has adopted this
  pattern either. Verdict unchanged — still a possible, unclaimed differentiator, still
  deliberately deferred.

## 5. New or changed since the last pass — ranked

Distinguishing genuinely new findings from restatements, as asked. Ranked by how material the
change actually is, not by how much text it generated.

1. **Full uBlock Origin permanently removed from the Chrome Web Store, Aug 31, 2026** (§2). The
   single most material, dated, well-sourced change this pass found — a primary competitor's flagship
   Chrome offering is now entirely gone, not degraded. Genuinely new; the original audit's "Chrome
   gets Lite" framing is now understated. No direct action for Moat beyond the messaging
   opportunity in §3a — Moat was already built MV3-native and unaffected by this purge either way.
2. **Firefox 149 quietly, experimentally ships Brave's `adblock-rust` engine, disabled by default**
   (§2). Genuinely new information (a March 2026 development this pass surfaced that wasn't in
   either prior doc), and a real industry-direction signal — two of six competitors (Brave,
   arguably now Firefox-the-platform) are investing in native, in-engine blocking rather than pure
   extension-based approaches. Not actionable today (inert, no UI), but worth tracking.
3. **A new, smaller MV3-era entrant (Stands AdBlocker) surfaced, with credible-but-not-fully-verified
   reports of contradicting its own "we don't collect data" marketing** (§2). Genuinely new to this
   pass, though the underlying claim carries a stated confidence caveat (secondary-sourced, not
   independently re-fetched from the original report). Useful as a fresh contrast point for
   Moat's existing positioning, not as a new competitor to formally track.
4. **Multi-account-containers-on-Chrome re-verified, not just re-cited** (§4) — same verdict as
   before, but now backed by direct evidence (a stalled third-party attempt) rather than the
   absence of a Chrome API alone. A confirmation, not a new finding, but a stronger one than
   existed in the original audit.
5. Everything else found this pass — Brave's 75% adblock-engine memory optimization, Ghostery's
   "Your Web, Lately" recap and Clear-Browsing-Data panel, Ghostery Search's closed beta (with no
   effect on the free extension), Privacy Badger's accessibility-focused June 2026 release,
   DuckDuckGo's minor 2026.8.24 dependency bump, eyeo's fresher Acceptable-Ads adoption numbers —
   is real, dated, and primary-sourced, but is competitor-internal engineering/UX polish that
   doesn't change any row of the comparison table in a way that implies a gap or an opportunity for
   Moat. Included in §1/§2 for completeness and because the brief asked for anything new or
   changed, not filtered out — but explicitly ranked last because none of it is actionable or
   surprising given each competitor's known trajectory as of the original audit.

**Bottom line**: ten days after a thorough audit is, unsurprisingly, mostly quiet. The one
genuinely significant event — Chrome's Manifest V2 purge finally completing and taking full uBlock
Origin down with it — validates Moat's own MV3-native architecture decision after the fact rather
than exposing any new gap to close.

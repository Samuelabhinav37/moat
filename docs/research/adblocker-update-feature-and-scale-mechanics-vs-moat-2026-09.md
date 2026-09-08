# How ad blockers work, update, and ship features — and how Moat compares, plus a 10k-user scale check (2026-09)

Four questions in one pass:

1. How the mainstream ad/tracker blockers actually **work**, **update themselves**, and **ship new
   features** — the operational side, not the filtering internals.
2. How **Moat** does the same three things.
3. Where Moat **matches**, where it's **ahead**, where it's **behind**, and how to close each gap.
4. If Moat were installed on **10,000+ users**, would anything "flatter" (buckle) — or does it still
   work?

**Deliberately not re-covered here** (already settled in the corpus, cross-referenced instead of
repeated):

- Filtering-engine internals across uBO/uBOL/AdGuard/Brave/Ghostery/Privacy Badger —
  [`ad-blocker-architecture-and-roadmap.md`](ad-blocker-architecture-and-roadmap.md) §1.
- Feature-parity tables — [`competitive-gap-audit.md`](competitive-gap-audit.md),
  [`competitive-gap-audit-2026-09.md`](competitive-gap-audit-2026-09.md).
- Moat's measured resource footprint and the six competitors' self-reported numbers, plus the
  UI side-by-side — [`data-usage-optimization-ui-user-demand-2026-09.md`](data-usage-optimization-ui-user-demand-2026-09.md)
  §1, §4.
- Why users churn / what they ask for — [`ad-blocker-mechanisms-and-user-irritation-2026-09.md`](ad-blocker-mechanisms-and-user-irritation-2026-09.md)
  Part 2, and that same data-usage doc §5.
- The coverage ceiling (SSAI / first-party masking / native ads) and the specific industry
  responses to it — see the chat-log research from the same session that produced this doc; a
  standalone `coverage-ceiling-and-industry-mitigations-2026-09.md` was offered but not yet
  written.

Confidence is flagged per claim: **[verified]** = read against Moat's own code or a primary source
this pass; **[web]** = live web search this pass, secondary sources; **[general]** = well-established
background.

---

## Part 1 — How they work (one-paragraph recap, pointer only)

Every mainstream blocker is the same three layers: (a) **network blocking** — a filter list of URL
patterns enforced either by real-time request interception (`webRequest`, MV2 / Firefox) or a
pre-compiled declarative ruleset (`declarativeNetRequest`, MV3); (b) **cosmetic filtering** — CSS
selectors injected per-site to hide leftover ad boxes; (c) **scriptlets** — small bundled JS snippets
that neutralise anti-adblock detectors and in-page ad logic. The filter lists (EasyList / EasyPrivacy
and vendor supplements) are the shared substance; the engine is the differentiator. Full mechanism
comparison is in `ad-blocker-architecture-and-roadmap.md` §1. Moat implements all three (DNR static
rulesets + `update-cosmetics.mjs`-built selectors + a bundled redirect/scriptlet resource set).

---

## Part 2 — How they update

### 2.1 The MV3 wall: what a Chrome Web Store extension may and may not refresh remotely

**[web]** Chrome's Manifest V3 remotely-hosted-code (RHC) policy
([developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)):

| Fetch from a remote server | Allowed? |
|---|---|
| JavaScript / WASM to execute | **No** — the core ban. |
| "data or things like JSON or CSS" — config, feature flags, data your bundled code reads | **Yes**, explicitly. |
| Server communication that *changes extension behaviour* (config-driven) | **Yes**, explicitly. |
| Remotely-sourced content fed into `declarativeNetRequest.updateDynamicRules(...)` | **Grey → hostile.** Not blessed by the docs, and enforcement in **early 2025** treated it as a violation (below). |
| "Unsafe" DNR rule types (`redirect`, `modifyHeaders`) added from a remote source | **No** — must be static or from a trusted in-package source. |

**[web]** The enforcement precedent: **AdGuard was forced to permanently remove its "Quick Fixes"
filter** and temporarily disable Custom filters to stay in the Chrome Web Store, because Google's RHC
wording is *"so broad that even ad-blocking rules fall under these restrictions"*
([adguard.com/blog/review-issues-in-chrome-web-store.html](https://adguard.com/en/blog/review-issues-in-chrome-web-store.html)).
Quick Fixes was exactly a "fast-track remote filter channel." It is gone.

**Net effect [web]:** on Chrome/Edge MV3, a new filtering rule reaches installed users **only through
a new extension version and a Web Store review** — a 1–5 day delay, weeks during a contested wave
(YouTube). Firefox is unaffected: it keeps `webRequest` and permits real-time remote list fetches
([adguard.com/blog/mv2-extensions-no-longer-alternatives.html](https://adguard.com/en/blog/mv2-extensions-no-longer-alternatives.html)).

### 2.2 Per-player update mechanics

| Player | How updates reach installed users | Cadence | Infra |
|---|---|---|---|
| **EasyList** (the upstream) **[web]** | Static text files on GitHub + **Cloudflare CDN**; clients poll on the interval in the list's own `! Expires:` header | ~4 days | Hit Cloudflare free-tier throttling at scale — needed sponsored/enterprise CDN ([adguard.com/blog/easylist-filter-problem-help.html](https://adguard.com/en/blog/easylist-filter-problem-help.html)) |
| **AdGuard extension (MV3)** **[web]** | A **build pipeline** ([`FiltersRegistry`](https://github.com/AdguardTeam/FiltersRegistry)) compiles filter templates → 8 per-platform outputs + **incremental diff patches** + localised metadata, served from `filters.adtidy.org`. Post-2025, the *extension's* filters update only via **frequent extension patch releases**; a tiny "safe" dynamic-rule allowance remains | list side hours; extension side = Web Store review; **24–48 h response** after a YouTube change | Own CDN + differential updates ([v4.3 blog](https://adguard.com/en/blog/adguard-browser-extension-v4-3.html)); nightly + beta + release channels |
| **uBO / uBO Lite (MV3)** **[web]** | uBOL: **nothing remote.** Static rulesets + scriptlets compiled into the package, updated *only* when the extension updates through Web Store review. Only the ~5,000-rule dynamic budget is updatable — too small for its ~17k default set | weeks during a wave | **Zero servers** — that's the privacy pitch; solo-led, rapid GitHub releases, beta channel |
| **Adblock Plus / eyeo (MV3)** **[web]** | Filter-list *subscriptions* from `easylist-downloads.adblockplus.org` (primary + fallback mirrors); MV3 bundles a snapshot, refreshes via extension releases. Historic `! Checksum:` (MD5) line largely deprecated | list ~daily | Company infra + mirrors; shared `webext-sdk` across ABP and AdBlock |
| **Brave** **[web]** | **Own component updater** (Chromium/Omaha-style). The ad-block list is a browser *component*, updated independently of browser releases, checked **every ~5 h** (tunable via their "Griffin" remote config); other components (NTP sponsored images) as often as 15 min | 5 h | The only true "backend pushes to client" model — available *because Brave isn't Web-Store-constrained* |

**The pattern:** nobody runs a live rules **API**. The "backend" is a **compile pipeline + static
files on a CDN**, poll-based, with the poll interval carried *in the list itself*, differential
patches for bandwidth, backup mirrors, and integrity via TLS + trust in the maintainer's infra (no
widespread cryptographic signing of filter lists) **[web/general]**.

### 2.3 How Moat updates **[verified — read against current `src/`]**

Two channels:

1. **Bundled, build-time (the bulk).** `npm run filters:update` runs `update-filters.mjs` (vendors
   `@adguard/dnr-rulesets` → 20 static DNR rulesets, ~273k rules), `update-cosmetics.mjs`,
   `vendor-consent-rules.mjs`, `vendor-cname-list.mjs`, `validate-rules.mjs`. Output is committed.
   A `v*` tag triggers `.github/workflows/release.yml` → build + test + `web-ext lint` + zip +
   `sha256sum` + a **draft** GitHub release. The maintainer then uploads to the Web Store / AMO by
   hand. CI (`ci.yml`) runs the full `filters:update` + validate + typecheck + test + build on every
   push.
2. **Live channel (the narrow slice).** `src/background/liveUpdates.ts` — a `browser.alarms` job
   (`{ delayInMinutes: 1, periodInMinutes: 1440 }`, re-created on every service-worker cold start)
   `fetch`es two files from `raw.githubusercontent.com/Samuelabhinav37/moat/master/live/`:
   - `redirect-domains.json` (~460 popup/redirect domains, ~8.5 KB) — applied **as dynamic
     `declarativeNetRequest` rules** via `updateDynamicRules(...)`, *and* fed to `popupGuard.ts`.
   - `quick-fixes.json` (empty `[]` today, ~2 bytes) — an emergency block/allow/strip-param channel,
     also applied via `updateDynamicRules(...)`. Rule shapes are validated (`quickFixRules.ts`,
     `liveRedirectRules.ts`) before use.
   Both fetches use **`cache: "no-store"`**. Failure → keep the bundled baseline, retry next tick.
   The file only changes when the maintainer runs `filters:update` and pushes; **no automation
   writes to the repo.**

Only other outbound calls for a consumer install: opportunistic **DoH CNAME lookups**
(`cnameUncloakChrome.ts`, only if CNAME uncloaking is enabled) and the **Athena** enterprise
endpoints (`athenaIntegration.ts` / `athenaPolicySync.ts`, dormant unless a managed policy sets
them). Everything else that looks like `fetch()` in `src/` is `browser.runtime.getURL(...)` reading
a **bundled** JSON file, not network.

---

## Part 3 — How they ship new features

| | Team | Dev process | Release channels | Typical feature→user latency |
|---|---|---|---|---|
| **uBO / uBOL** **[web]** | Solo-led + contributors | Public GitHub, issue-driven, heavy manual QA, "-rc" pre-releases | dev / beta / stable on AMO + CWS | Days for the extension; **filters are the extension** on uBOL, so filter fixes inherit store-review latency |
| **AdGuard** **[web]** | Company, multi-platform | Per-platform repos, nightly (≈daily new features) + beta + release; filter templates in a separate registry repo with its own pipeline | nightly / beta / release per platform | Filters: hours. Extension features: a beta cycle. YouTube counters: 24–48 h |
| **Brave** **[web]** | Company, Chromium fork | Chromium's cadence for the browser; **components** decoupled and pushed on their own schedule | Nightly / Dev / Beta / Release browser; components continuous | Filter/component: ~5 h. Browser features: the Chromium train |
| **eyeo (ABP/AdBlock)** **[web]** | Company | Shared `webext-sdk`; GitLab; feature flags | beta + stable | Extension features: a release cycle; lists: ~daily |
| **Moat** **[verified]** | **Solo maintainer** | Plan-mode workflow, granular versioned commits with full verification (`typecheck` + `vitest` + `build` + `web-ext lint`) each time; `CHANGELOG.md` is the source of truth; research-doc-first for anything non-trivial | One stable channel (CWS + AMO); `v*` tag → draft GitHub release; **no beta/nightly** | Bundled filters + features: **one manual Web Store submission** (author-gated, hours of work + 1–5 day review). Live channel: **~1 day**, and only for block/allow/strip-param |

---

## Part 4 — Moat vs. the field

### 4.1 Where Moat **matches** the mainstream

- **Three-layer model** (network + cosmetic + scriptlet/redirect) — present and tested.
- **Vendored upstream lists** — `@adguard/dnr-rulesets` + `@ghostery/trackerdb`, the same substance
  AdGuard and Ghostery ship, refreshed by script.
- **CI on every push** — build + validate + typecheck + test + Firefox lint. On par with AdGuard's
  per-platform CI; ahead of "solo maintainer running things locally."
- **Tag-driven release with checksums** (`SHA256SUMS.txt`, tag-vs-`package.json` guard) — a cleaner
  release trail than most single-maintainer extensions.
- **A live-update channel at all** — most MV3 extensions have *nothing* between store releases; Moat
  has the narrow redirect/quick-fix slice. This is the AdGuard-Quick-Fixes idea, kept deliberately
  small.
- **Graceful degradation** — a failed live fetch silently keeps the bundled baseline. Correct.

### 4.2 Where Moat is **ahead**

- **Zero telemetry, zero account, zero Moat-operated server** — stronger than AdGuard (company
  infra, DNS logs), eyeo (Acceptable Ads business), Ghostery (historic data practices). Only uBOL
  matches this, and uBOL matches it by having *no* live channel at all.
- **Honest, published resource number** — Moat discloses one real (caveated) measurement;
  `data-usage` §1 found that's more transparency than 4 of 6 competitors, who publish nothing.
- **Quiet by default** — no nag screens, no onboarding tabs, no "rate us." A deliberate contrast
  with eyeo/Ghostery/AdGuard onboarding.
- **Structural monetisation ceiling** — no user data and no server means a future ownership change
  has little to sell; a stronger guarantee than a policy statement
  (`ad-blocker-mechanisms-and-user-irritation-2026-09.md` §2.8).
- **The live channel's scope is capped in code** — a quick-fix entry can only block, allow, or
  strip params. Even if the source were compromised it cannot inject script or redirect. That
  restraint is better-designed than AdGuard's Quick Fixes was.

### 4.3 Where Moat is **behind** — and how to fix it

| # | Gap | Why it matters | Fix | Cost |
|---|---|---|---|---|
| B1 | **The live channel violates the same MV3 policy AdGuard got hit for** — remotely-fetched content → `updateDynamicRules(...)`, and `redirect-domains.json` becomes `redirect` rules ("unsafe" type). | Web Store rejection risk the moment Moat draws review attention, independent of user count. | **Reframe as data, not rules.** Keep fetching the JSON, but have the bundled background/content logic *consult* it (as `popupGuard.ts` already does for the redirect list) instead of pushing it through `updateDynamicRules`. Drop the `redirect`-rule path; keep block/allow as the ~5k "safe" dynamic budget only, or move redirects to a bundled static ruleset refreshed by extension release. | Medium — rework `liveRedirectRules.ts` / `quickFixRules.ts` application path + tests. |
| B2 | **`raw.githubusercontent.com` is the whole "CDN."** Single point of failure (the repo went private once and silently broke the channel — `design-notes.md`), no cache-control contract, GitHub AUP prohibits CDN-style use. | Fine at small scale, a liability past ~100k (Part 5). | Move the two `live/*.json` to a real static host with a cache contract — **Cloudflare Pages / R2, jsDelivr (`cdn.jsdelivr.net/gh/...`), or a cheap object bucket**. jsDelivr is a one-line URL change and is *built* to front GitHub repos. Pin a SHA-256 of the payload in the extension and verify after fetch. | Small — URL change + a hash check. |
| B3 | **`cache: "no-store"` on both fetches.** Forces every client past any edge cache to origin. | Turns N cache-friendly reads into N origin reads — the single biggest scale multiplier. | Drop `no-store`. Respect the host's `Cache-Control`; add a `?v=<date>` cache-buster only when the maintainer actually pushes a change (write the date into the JSON or a sibling `version` file). | Trivial. |
| B4 | **No poll jitter.** `delayInMinutes: 1` from each service-worker cold start + a fixed 1440-min period. | Not a synchronised herd today (installs and SW cycles are spread), but there's no deliberate spreading, and re-creating the alarm on every cold start can fire the 1-min refresh far more than once/day for users who restart the browser often. | Randomise: `periodInMinutes: 1440`, `delayInMinutes: 60 + Math.random()*720`. Guard against re-running within N hours by storing `lastFetchAt` and skipping if fresh. | Trivial. |
| B5 | **No differential updates.** The whole `redirect-domains.json` is re-fetched each time. | ~8.5 KB is nothing now; matters if the live lists ever grow (cosmetics, per-site fixes). | Not worth building until a live list crosses ~100 KB. Note it and move on. AdGuard's diff format is the reference if it ever matters. | Deferred. |
| B6 | **Filter freshness is store-review-bound for everything except the ~460-domain slice.** Same constraint as uBOL — but uBOL *chose* it for zero-network purity, whereas Moat already accepts a network channel, so it could carry more. | A YouTube/anti-adblock wave = a manual submission + 1–5 day wait for anything not expressible as block/allow/strip-param. | Two options, not mutually exclusive: (a) **automate the release pipeline** so a `filters:update` push auto-tags, builds, and *submits* to the Web Store via the API (`chrome.webstore` publish API / `web-ext sign` for AMO) — turning "hours of manual work" into "merge to main"; (b) **widen the live channel's safe surface** — cosmetic-hide selectors are *data* the content script applies, not DNR rules, so a `live/cosmetic-fixes.json` consulted by `cosmeticFilter.ts` is policy-clean and covers the most common wave scenario (a stale selector). | (a) Medium. (b) Medium, and it's the higher-value one. |
| B7 | **No beta/nightly channel.** | No way to dogfood a risky filter/engine change before it hits all users; every release is to everyone. | A CWS "trusted testers" listing or an unlisted AMO build, fed by a `beta` branch. Low urgency at current scale. | Small, low priority. |
| B8 | **Manual store upload.** The release workflow stops at a *draft GitHub release*. | The slowest, most error-prone step (wrong zip, forgot AMO) is the unautomated one. | Extend `release.yml` with a `publish` job using the Chrome Web Store API + `web-ext sign`, gated on a manual `workflow_dispatch` approval so it's automated-but-deliberate. | Small. |

---

## Part 5 — Will Moat "flatter" at 10,000+ users?

**Short answer: no. Nothing in Moat has a shared bottleneck that user count can overload. The one
external dependency (`raw.githubusercontent.com`) is comfortably within tolerance at 10k, needs
hardening before ~100k, and must be moved off GitHub before ~1M.**

### 5.1 What scales for free (no Moat-operated infrastructure exists)

| Concern | Who bears it at scale | Verdict |
|---|---|---|
| **Distribution of the .crx/.xpi** | Google (Chrome Web Store) / Mozilla (AMO) | Their CDN. 10k or 10M — not Moat's problem, not Moat's cost. **[general]** |
| **Extension auto-update** | Google's Omaha update service / AMO | Same. **[general]** |
| **All blocking: 20 static DNR rulesets, ~273k rules, cosmetics, scriptlets, popup guard, consent rejector, fingerprint guard** | Each user's own browser, locally | **No shared state, no coordination, no server round-trip.** Every install is fully independent. Adding users adds zero load anywhere central. This is the whole point of a client-side MV3 extension. **[verified]** |
| **DoH CNAME lookups** (if enabled) | The public DoH resolver (Cloudflare 1.1.1.1 / Google) | Those resolvers serve billions of queries/day. 10k users doing a handful of novel-hostname CNAME lookups each is invisible to them. Not a Moat scale concern. (The *privacy* tradeoff is separate — see `ad-blocker-architecture-and-roadmap.md` item 3.) **[web/general]** |
| **Athena telemetry** | Only exists under enterprise managed policy; the org runs its own endpoint | Not a consumer-scale path at all. **[verified]** |

### 5.2 The one thing to watch: the GitHub-raw live-update fetch

**Traffic math [verified payload sizes + web on GitHub limits]:**

- Payload per client per fetch: `redirect-domains.json` ~8.5 KB + `quick-fixes.json` ~0 KB ≈ **~9 KB**
  (uncompressed; gzip over the wire ≈ 3–4 KB).
- Fetches per client per day: **~1–3** (one scheduled + the alarm re-creation firing ~1 min after
  browser-session cold starts; see B4).
- **10,000 users:** ~10k–30k requests/day, **~90–270 MB/day**, ~3–8 GB/month of GitHub egress.
- 100,000 users: ~1–3 GB/day.
- 1,000,000 users: ~10–30 GB/day, ~500k–3M requests/day.

**What GitHub allows [web]:** `raw.githubusercontent.com` is **more aggressively rate-limited than
`github.com`, IP-based**, GitHub tightened unauthenticated limits in **May 2025**
([github.blog changelog](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)),
and the Acceptable Use Policy prohibits **"excessive or abusive" bandwidth** and using the service
**"as a content delivery network."** GitHub doesn't publish the numbers and *"reserves the right to
throttle or block."* EasyList hit exactly this pattern on Cloudflare's free tier.

**Assessment by scale:**

- **10k users — fine.** ~100–270 MB/day is trivial bandwidth. Requests come from ~10k distinct
  residential IPs, ~1–3/day each — nowhere near a per-IP limit, and the aggregate is well below
  anything that trips CDN-abuse heuristics. The channel keeps working. The failure mode if GitHub
  *did* throttle is already handled: clients fall back to the bundled baseline and retry.
- **~50k–100k — the grey zone.** Still probably fine on bandwidth, but now it *looks* like a CDN
  workload (steady, automated, single repo path, `no-store` forcing origin hits). This is where B2 +
  B3 stop being nice-to-haves. With `no-store` dropped and a real cache contract, 100k clients
  spread over a day are mostly served 304s / edge hits and GitHub barely notices — but on the
  current code, 100k × `no-store` = 100k+ origin reads/day of the same file, which is precisely the
  "using us as a CDN" shape.
- **~500k–1M+ — untenable on GitHub.** Move to a real static host (B2). At that point also do B5
  (diffs) and B4 (jitter) properly.

**Other client-side effects of "many users"** (each is per-install, so user count doesn't change
them — listed only to close the question): per-page cost is ~700 KB of shard JSON after
domain-hash bucketing and the cosmetic-trim jank was fixed in v0.11.27
(`data-usage-optimization-ui-user-demand-2026-09.md` §1, `deep-review-findings.md` Finding 1). A
10,000th user's browser behaves exactly like the first user's.

### 5.3 If Moat ever *wants* a real backend

It doesn't need one to scale the current feature set. It would need one only to add: real-time
rule push (Brave-style component updater — not possible for a CWS extension anyway, see B1),
server-side breakage-report triage, cross-device sync, or a hosted rule-compile service. All of
those are **net-new scope** with their own cost, privacy, and "something to sell in an acquisition"
implications (§2.8 of the irritation doc). The minimal, philosophy-preserving version is just
**B2** — two JSON files on a static host with a cache contract and a pinned hash. That is a
"backend" only in the loosest sense, scales to millions for a few dollars a month, and keeps the
zero-telemetry / nothing-to-sell property intact.

---

## Closing synthesis — the prioritized list

1. **B3 (drop `cache: "no-store"`) + B4 (add jitter + a `lastFetchAt` guard).** Trivial, and they
   are the difference between "10k is fine" and "10k looks like abuse." Do these regardless of any
   growth plan.
2. **B2 (move `live/*.json` to jsDelivr or an object bucket + pin a SHA-256).** One-line URL change
   plus a hash check; removes the single point of failure and the AUP exposure. Do before any
   promotion push.
3. **B1 (stop feeding remote content into `updateDynamicRules`; consult it as data).** The Web Store
   *policy* risk — untied to user count, so it can bite at any time. Higher engineering cost;
   schedule it deliberately.
4. **B6(b) (a policy-clean `live/cosmetic-fixes.json` the content script applies).** The
   highest-*value* item: it's the piece that would actually shorten "YouTube changed a selector" from
   a 1–5 day store wait to a same-day push, without touching DNR rules at all.
5. **B8 (automate the store upload) / B6(a) (auto-submit pipeline).** Removes the slowest manual
   step; makes frequent small releases — the AdGuard model — actually sustainable for one person.
6. **B7 (beta channel), B5 (differential updates).** Defer until scale or release frequency makes
   them pay for themselves.

Everything else about Moat's operational model is already at or above mainstream practice for a
single-maintainer extension: CI on every push, checksummed tag-driven releases, vendored upstream
lists, graceful degradation, and a deliberately capped live-update surface. The gaps are all in one
place — the live channel's **hosting, caching, and policy posture** — and every fix above is small
or medium, none require a server, and none cost the zero-telemetry property.

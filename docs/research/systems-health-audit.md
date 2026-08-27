# Systems health audit: complexity, storage patterns, caching, memory, dependency weight, dead code

A fresh pass, deliberately different in scope from `code-quality-audit.md` (which covered dead
code and hot-path Big-O) and `deep-review-findings.md` (real-browser profiling + adversarial
input). This one looks at storage-access patterns (the closest analog to "database queries" in an
extension with no backend), caching correctness, memory-growth risk over a long browsing session,
and dependency/build-artifact weight -- with every claim below traced to the actual code or a real
measurement, not asymptotic reasoning alone. Findings are split into **confirmed** (verified by
reading the exact code path or running a real check) and **needs runtime profiling** (a real
question this audit can name but not answer from static reading).

## Confirmed findings

### 1. Redundant duplicate settings reads in 3 content scripts (new, real, small)

`cosmeticFilter.ts`, `consentRejector.ts`, and `leakedPasswordCheck.ts` each read the exact same
`browser.storage.local` key twice on every page load, in two separate calls that don't share their
result:

- `siteDisabled.ts`'s `isDisabledHere()` (called by all three) does its own
  `browser.storage.local.get(STORAGE_KEY)` to check `settings.enabled`/`disabledSites`.
- Each of the three scripts *also* does its own independent `browser.storage.local.get(STORAGE_KEY)`
  immediately before or after that call, to read its own feature flag
  (`customCosmeticRules`/`customGrayscaleRules` in `cosmeticFilter.ts:32`,
  `cookieBannerAutoReject` in `consentRejector.ts:29`, `leakedPasswordCheck` in
  `leakedPasswordCheck.ts:21`).

Concretely, `cosmeticFilter.ts`'s `run()` calls `isDisabledHere()` at line 38, then separately
calls `loadCustomRuleMaps()` at line 48 -- two full reads of the same settings blob within one
function, when both facts (site-disabled state and the feature flag) are available from a single
read. This is the direct analog of an N+1 query: the "row" (the settings document under
`STORAGE_KEY`) is fetched twice per script instead of once. It happens on every single page load,
across the 3 content scripts that inject on `<all_urls>` at `document_idle`/`document_start`.

**Not** a bug across scripts -- each content script is an isolated JS execution context (separate
world), so the 3-way duplication *across* `cosmeticFilter`/`consentRejector`/`leakedPasswordCheck`
can't be deduped without a cross-context message round trip (which would trade one storage IPC
call for one runtime-message IPC call -- not obviously cheaper, arguably worse since it adds a
background-context wake). The redundancy worth fixing is only the **intra-script** one: 2 reads
where 1 would do, in 3 places. A trivial fix -- read once, derive both the disabled check and the
feature-flag check from that single object -- with real, if likely small, upside: one fewer
`browser.storage.local.get` IPC round trip per script per page load, across what's very likely the
single most frequently-executed code path in the whole extension (once per page load, for every
page, for every install). Left unfixed here since this audit's scope was find-and-report, not fix.

### 2. `zip.mjs` has no exclusion list -- currently harmless, but silently unguarded

`scripts/zip.mjs` tars *everything* under `dist/<target>` with no filter (`tar ... -C ${dir} .`).
`scripts/build.mjs` line 48 wipes `dist/<target>` with `rmSync(..., { recursive: true, force: true })`
before every build, so a normal `npm run build && npm run zip` is clean. But Chrome itself writes a
`_metadata/generated_indexed_rulesets/` directory (confirmed present locally, ~12MB, timestamped
from this session's own unpacked-extension testing in `dist/chrome`) the first time the unpacked
extension is loaded for local testing/debugging. If `npm run zip` is ever run again *without* a
preceding `npm run build` -- exactly the mistake this session already made once this run while
preparing the Chrome Web Store submission zip (caught only by manually inspecting the zip's bundled
`manifest.json`, not by any tooling) -- that 12MB Chrome-internal cache directory would silently
ship inside the submission zip. Confirmed absent from the actual `chrome.zip` currently in the repo
root (checked via `tar -tf chrome.zip | grep -i metadata`, no match), so this is not a live problem
today -- but it's a real gap with no guard rail, one `npm run zip` (no rebuild) away from
recurring, and worth a one-line defensive exclude (`--exclude=_metadata`) given it already bit this
exact workflow once this session in a different way (stale-version zip).

### 3. Sync-quota failures are silent everywhere, including in the UI

`settings.ts:56` mirrors settings to `browser.storage.sync` with `.catch(() => {})` on failure --
deliberate and documented in its own comment ("a quota failure ... just means sync silently doesn't
happen for this install"). `browser.storage.sync` caps at ~100KB total and ~8KB per item; a user
with enough custom cosmetic rules or blocked/allowed sites can plausibly exceed the 8KB per-item cap
for the single `STORAGE_KEY` blob sync writes as one item. Checked `options.ts`: the sync toggle
(`options.ts:449`, `:577`) only ever reads/writes `settings.syncEnabled` -- there is no success/
failure state surfaced anywhere in the options UI. A user who turns "Sync settings" on, with more
custom rules than fit in 8KB, sees the toggle as permanently "on" with zero indication that sync
has never actually succeeded once. This is a known, accepted tradeoff per the code's own comment,
not a hidden bug -- named here because "how well does it work" should include "does the user find
out when a feature they turned on silently isn't doing anything," and today the answer is no.

### 4. Caching: every cache found is correctly bounded or correctly unbounded

Checked every module-level cache in `src/background`:

- `cnameUncloak.ts`'s `canonicalNameCache` (Map, DNS resolution results): capped at
  `MAX_CACHE_ENTRIES = 500`, wholesale-cleared when full (`cnameUncloak.ts:52`) -- crude but
  genuinely bounded, and its own comment explains why a full clear-and-restart is an acceptable
  cost for a best-effort speed-up cache, not a correctness-load-bearing one. Failures are
  deliberately never cached (a transient DNS hiccup shouldn't become a standing uncloak-bypass
  window) -- correct choice, re-verified against the actual code, not just the comment.
- `matchStats.ts`'s `companiesCache` and `filterGroups.ts`'s ruleset-manifest cache: never
  invalidated, and correctly so -- both cache static, build-time-baked JSON that cannot change
  without a new extension version (and thus a fresh service-worker cold start, which resets every
  module-level variable anyway).
- `filterGroups.ts`'s applied-settings fingerprint (`APPLIED_FINGERPRINT_KEY`, `:17`): lives in
  `browser.storage.session` under one fixed key, not a growing collection -- bounded by
  construction, and self-invalidates correctly on a failed apply (removed, not left stale, at
  `:130`) so a degraded state can't get permanently miscached as "done."

No unbounded cache, no stale-cache-masking-a-real-failure pattern found anywhere in `src/background`.

### 5. Memory growth: per-tab state re-verified bounded; listener registration re-verified leak-free

Re-checked (independently of the prior audit's same claim) that `badge.ts`, `matchStats.ts`, and
`ruleLogger.ts`'s per-tab `Map`s all route through the shared `clearTabFromMaps` helper wired to
`browser.tabs.onRemoved` in `background/index.ts:102` -- bounded by currently-open-tab count, not a
session-long leak. Also checked every `addListener` call across `src/background` (12 call sites):
all either run exactly once at module top level (fires once per service-worker cold start, e.g.
`index.ts:82-142`, `liveUpdates.ts:129`, `ruleLogger.ts:61`, `popupGuard.ts`'s three listeners,
called once from `initPopupGuard()` which is itself called once at `index.ts:40`), or are
explicitly guarded against double-registration with a boolean flag before adding
(`cnameUncloak.ts`'s `registered` flag at `:96,109,111,114`, checked and toggled correctly on both
the add and remove path). No listener is added inside a function that can run more than once
without such a guard -- meaning no duplicate-listener leak across repeated settings changes within
one service-worker lifetime.

`popupGuard.ts`'s `pendingWatch` Map (tracks a tab briefly after `window.open("")` while waiting to
see its real destination) is bounded by real open-tab count too: cleared on a match
(`popupGuard.ts:91`), on expiry-then-next-update (`:85`), and unconditionally on tab close (`:97`).
Worst case is one stale entry per tab that opens as `about:blank` and is never subsequently
navigated or closed -- bounded by the number of tabs the user actually has open, not unbounded.

### 6. Algorithmic complexity: no new quadratic or worse pattern found

Specifically checked the two request-volume-scaling paths not covered by the prior audit's pass:
`matchedRuleCategories.ts`'s `summarizeMatchedRules` and `matchedRuleCompanies.ts`'s
`summarizeCompanies`, both called once per navigation from `matchStats.ts:refreshBreakdown`. Both
build a `Map` once from the manifest (`idToGroup`, `matchedRuleCategories.ts:41`) and then do a
single `Map.get` per match -- O(manifest + matches), not O(manifest × matches). Consistent with
`code-quality-audit.md`'s finding for the other hot paths: this codebase's convention of reaching
for `Map`/`Set` instead of nested array scans holds up everywhere checked, in this pass and the
last one.

### 7. Dependency and build-artifact weight

- **Runtime dependency surface: 1 package** (`webextension-polyfill`). Every other package in
  `package.json` is correctly scoped to `devDependencies` (typescript, vite, vitest, web-ext, the
  two filter-data packages `@adguard/dnr-rulesets`/`@ghostery/trackerdb` used only at build time to
  generate `rules/dnr/`, which is gitignored and never shipped as a raw dependency). This is about
  as small a supply-chain/audit surface as a project like this can have; worth stating with the
  actual number since "dependency weight" was explicitly asked about, not just asserting "it's
  fine."
- **Unpacked `dist/chrome`: 61MB**, broken down: 49MB is `rules/` (the actual DNR JSON + cosmetic
  filter data -- the bundled AdGuard/Ghostery filter lists this extension exists to ship), 12MB is
  `_metadata/` (Chrome's own local-testing artifact, see finding #2 -- not shipped in the real zip).
  Real shippable weight is closer to **49MB**, essentially all of it filter data proportional to
  ~276,000 bundled rules across 11 groups (per `settings.ts`'s own comment) -- the same category of
  size as any filter-list-based blocker (uBlock Origin's own bundled lists are comparably large).
  Not a new finding -- `dnr-rule-consolidation-audit.md` and the v0.11.26 pruning automation already
  addressed reducible redundancy in this data -- named here with the concrete current number since
  this pass's brief explicitly asked about resource weight.
- **Individual bundled scripts are all small**: the largest, `options.js`, is 32KB; `background.js`
  is 28KB; every content script is 12-20KB. No bloated bundle anywhere in the actual code (as
  opposed to filter data).

### 8. Dead code: still none, re-checked against the delta since the last full sweep

`code-quality-audit.md`'s unused-export and reachability sweep is 6 commits old as of this audit.
The delta since then (the IDN-domain fix, the idle-callback chunking fix, and this session's
privacy-policy accuracy fix) touched `applyCustomRules.ts`, `cosmeticFilter.ts`, `PRIVACY.md`,
`messages.json`, and `options.html` -- spot-checked each for new dead code (new unused exports, new
unreachable branches): none found. The two new hardcoded-English `<p>` paragraphs added to
`options.html` for the privacy-policy fix are intentionally not dead -- they're rendered
unconditionally in the About tab, same as the existing hardcoded-English paragraphs they sit next
to (documented at the time as a deliberate pattern, since `applyStaticI18n` would strip their
embedded `<strong>` markup).

## Risks that need runtime profiling, not just code reading

These are real, honestly-scoped open questions -- named because static reading can't answer them,
not because there's evidence of an actual problem:

- **Real-world cost of finding #1's redundant reads.** `browser.storage.local.get` on a small blob
  is typically sub-millisecond in Chrome's in-process storage backend, so the extra IPC round trip
  per script is very likely not user-perceptible -- but "very likely" is an assumption, not a
  measurement. This audit did not instrument real page-load timing with and without the duplicate
  read to confirm the actual delta is negligible.
- **Service-worker cold-start cost under realistic multi-tab browsing.** The whole background
  module re-executes on every cold start (documented architecture, not new). This audit's checks
  (listener registration, cache bounds) all reasoned about *one* service-worker lifetime in
  isolation. What hasn't been measured: the aggregate cost across a real session with many
  cold-start/wake cycles (heavy tab-switching, long idle gaps) -- e.g., whether
  `applyFreshInstallDefaults`/`seedFromSyncIfEmpty`'s extra `storage.local.get` calls on every
  `onInstalled`/startup path add up to anything noticeable across a day of real use. Needs a real
  profiling session (chrome://extensions service worker inspector, real tab-switching), not
  asymptotic reasoning.
- **`selectorsStillMatching`'s per-page cost on pathologically complex real-world DOMs.** Already
  named in both `code-quality-audit.md` and `deep-review-findings.md` and already mitigated
  (`requestIdleCallback` chunking, v0.11.27) -- re-flagged here only because it remains the one path
  in the whole codebase whose real cost is genuinely page-dependent rather than bounded by Moat's
  own data size, and this audit did not re-run the real-Chrome benchmark from `deep-review-findings.md`
  against a *different* class of page (e.g., an infinite-scroll social feed with thousands of live
  DOM nodes, rather than the synthetic 5,000-element DOM used there).
- **Sync-quota-exceeded's actual frequency in practice** (finding #3). Whether real users with
  heavy custom-rule usage actually hit the ~8KB per-item `storage.sync` cap often enough to matter
  is an open, unmeasured question -- this audit can only confirm the failure mode exists and is
  silent, not how often it fires for real installs.

## Method

Read every module-level cache/Map/listener-registration site in `src/background` directly (not a
sample); grepped for every `storage.local.get`/`storage.sync.get` call site across `src/content`
and cross-referenced each against the content-script manifest entries that actually inject it, to
determine real per-page-load call counts rather than assuming from file count alone; measured
`dist/chrome`'s real on-disk size and per-subdirectory breakdown directly (`du`), and confirmed the
`_metadata` exclusion question by inspecting the actual `chrome.zip` currently in the repo with
`tar -tf`, not by reasoning about the build script alone. No new automated tooling was written for
this pass -- prior sessions' unused-export/reachability scripts were reused conceptually (spot-check
the delta) rather than re-run in full, since the delta since the last full run is small and named
explicitly above.

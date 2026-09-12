# $redirect Resource Files and the NextDNS CNAME-Cloak List: Verification Against Primary Sources

Researched 2026-09-12. `docs/research/ad-blocker-architecture-and-roadmap.md`'s
"Candidates for Moat" section (2026-08-24) listed two items as open gaps: (1) shipping
AdGuard's `$redirect` no-op resource files so `$redirect` rules stop being dropped, and
(2) adopting NextDNS's public CNAME-cloak-destination list as a heuristic signal. This
doc was commissioned to verify both technically before anyone wrote an implementation
plan.

**Headline finding, stated plainly up front because it changes the shape of any
follow-up work: both items are already shipped in Moat's current source, not open
gaps.** Reading `scripts/update-filters.mjs`, `scripts/manifest.ts`, `scripts/build.mjs`,
`src/background/cnameUncloak*.ts`, `scripts/vendor-cname-list.mjs`, and Moat's own
`CHANGELOG.md` (not just the roadmap doc that flagged them) shows:

- The `$redirect` resource-file gap was closed in **v0.7.5** (CHANGELOG.md, "Stopped
  dropping ~990 `$redirect` filter rules"). **[measured]**
- The NextDNS CNAME-cloak-destination list was adopted in **v0.9.0** (CHANGELOG.md,
  "Uncloak disguised trackers (Firefox only, off by default)"), and later extended to
  Chrome via a DoH-based approximation (CHANGELOG.md's `cnameUncloakChrome.ts` entry,
  §189/§663 range). **[measured]**

Moat's own package.json is currently at version 0.11.79, well past both of these
releases. **[measured]** This means the prior roadmap doc's "Candidates for Moat" items
1 and 2 describe work that was already done by the time that doc was written
(2026-08-24) — an example of exactly the staleness risk this repo has already been
burned by once. The rest of this document verifies the *current, shipped* state of both
features against primary sources (the actual installed packages, the actual compiled
output, and the actual upstream NextDNS repo) rather than treating them as unbuilt.

---

## Question 1: AdGuard's `$redirect` resource files

### 1. Does `@adguard/dnr-rulesets`' compiled output reference named resource files?

Yes, confirmed by reading the actual installed package. `package.json` pins
`"@adguard/dnr-rulesets": "^4.0.20260823030056"`; the version actually installed under
`node_modules/@adguard/dnr-rulesets` is `4.2.20260826030101` (its own
`node_modules/@adguard/dnr-rulesets/package.json`), which satisfies that caret range.
**[measured]**

Grepping the compiled ruleset JSON directly
(`node_modules/@adguard/dnr-rulesets/dist/filters/chromium-mv3/declarative/ruleset_*/ruleset_*.json`)
for `"redirect"` and `"extensionPath"` shows every `$redirect`-derived rule takes the
exact shape:

```json
"redirect":{"extensionPath":"/web-accessible-resources/redirects/nooptext.js"}
```

Sampled resource filenames actually referenced across `ruleset_1`, `ruleset_2`,
`ruleset_11`, and `ruleset_13` include `1x1-transparent.gif`, `2x2-transparent.png`,
`32x32-transparent.png`, `noopjs.js`, `nooptext.js`, `noopcss.css`, `noopframe.html`,
`noopjson.json`, `noopmp3.mp3`, `noopmp4.mp4`, `noopvast02.xml`, `googlesyndication-adsbygoogle.js`,
`googletagservices-gpt.js`, `google-ima3.js`, `amazon-apstag.js`, and `gemius.js` — all
under the fixed path prefix `/web-accessible-resources/redirects/`. **[measured]**

Counting for real (not estimating) across the exact 11 rulesets Moat's
`scripts/update-filters.mjs` consumes (ids 2, 3, 4, 17, 18, 19, 21, 208, 255, 256, 257 —
see `RULESETS` in that file), there are **997 extensionPath-based `$redirect` rules**
in the raw AdGuard source, referencing **30 distinct resource filenames**. **[measured]**
(Counted directly from the raw, pre-pruning source JSON via a throwaway Node script
against the installed package — not from Moat's already-processed output, to check the
upstream data independent of Moat's own pipeline.)

### 2. Does a separate package ship the actual resource bytes? Is it installed?

Yes — **`@adguard/scriptlets`**, and it is already present in `node_modules`, though
**not as a direct devDependency of Moat's own `package.json`**. It arrives transitively:
`package-lock.json` shows `@adguard/dnr-rulesets` depends on `@adguard/tsurlfilter@5.0.1`,
which depends on `@adguard/scriptlets@2.4.2`. **[measured]**

`node_modules/@adguard/scriptlets/package.json` confirms:
- name: `@adguard/scriptlets`
- version installed: **2.4.2**
- license: **GPL-3.0** (matches Moat's own license, see Q2.4 below for the
  cross-license question, which doesn't even arise here since both are GPL-3.0)
- description: "AdGuard's JavaScript library of Scriptlets and Redirect resources"

**[measured]**

The actual resource bytes live under
`node_modules/@adguard/scriptlets/dist/redirect-files/`, one real file per resource
name — confirmed by directory listing: `1x1-transparent.gif`, `2x2-transparent.png`,
`32x32-transparent.png`, `3x2-transparent.png`, `click2load.html`, `noopjs.js`,
`nooptext.js`, `noopcss.css`, `noopframe.html`, `noopjson.json`, `noopmp3.mp3`,
`noopmp4.mp4`, `noopvast02.xml`/`03.xml`/`04.xml`, `noopvmap01.xml`, plus ~15
named tracker-neutering scripts (`google-analytics.js`, `googletagservices-gpt.js`,
`amazon-apstag.js`, `prebid.js`, `fingerprintjs2.js`/`3.js`, `prevent-bab.js`,
`prevent-popads-net.js`, etc.). There's also a machine-readable index at
`node_modules/@adguard/scriptlets/dist/redirects.yml` (and `.json`) mapping each
resource's `title`/`file`/`contentType`/base64 `content` — e.g. the `1x1-transparent.gif`
entry's `content` is `R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==`. **[measured]**

`click2load.html` (the example named in the task) does exist in the package, but is
**not currently referenced by any rule in the 11 rulesets Moat consumes** — it's not
among the 30 filenames actually pointed at (see Q1.1). It would only become relevant if
Moat later starts pulling additional filter lists whose `$redirect` rules reference it.
**[measured]**

Checked the public npm registry directly (`registry.npmjs.org/@adguard/scriptlets`,
fetched live this pass): the current published `dist-tags.latest` is **2.5.1**
(license `GPL-3.0`), two minor versions ahead of the `2.4.2` Moat currently gets
transitively. This is a currency note, not a functional gap — Moat isn't missing any
resource file the 2.4.2 tree lacks for its current 30-filename need, but a version bump
of `@adguard/tsurlfilter`/`@adguard/dnr-rulesets` could shift what's transitively
installed without Moat ever touching `@adguard/scriptlets` directly, which is worth
flagging precisely because it's an indirect dependency Moat doesn't control by version
today. **[web]**

### 3. Does the build pipeline drop `$redirect` rules? Real numbers.

**No, not anymore, and it hasn't since v0.7.5.** Reading `scripts/update-filters.mjs`
in full (lines 93-124) shows the actual logic:

```js
if (rule.action?.type === "redirect" && rule.action.redirect?.extensionPath) {
  const resource = resolveRedirectResource(rule.action.redirect.extensionPath, availableRedirectResources);
  if (!resource) {
    droppedRedirectRules += 1;
    continue;
  }
  neededRedirectResources.add(resource);
}
```

`resolveRedirectResource` (`scripts/lib/redirectResources.mjs`) is a small pure
function: it takes the `extensionPath`'s basename and checks it against the set of
filenames actually present in `node_modules/@adguard/scriptlets/dist/redirect-files`,
returning the name if shipped or `null` if not. A rule is dropped **only if the
specific resource it points at isn't shipped**, not as a blanket policy against
`$redirect` rules. **[measured]**

Reproducing this resolution logic directly against the installed packages (not
Moat's already-built output, to check the pipeline's actual behavior end-to-end) gives:

```
total 997   resolved 997   dropped 0   droppedNames []
```

**All 997 extensionPath-based `$redirect` rules across the 11 consumed rulesets
currently resolve to a shipped resource file. Zero are dropped today.** **[measured]**

This matches what's actually on disk: `rules/dnr/` in the main checkout (build output,
gitignored, but present from a prior `npm run filters:update` run) contains
`redirect-domains.json` etc., and directly counting `action.type === "redirect"` rules
across every compiled `rules/dnr/*.json` file gives **3,484 total redirect-action
rules**, of which **997 are `extensionPath` resource redirects** (the AdGuard-sourced
ones this question is about) and **2,487 are Moat's own first-party
`queryTransform`-based redirects** (the tracking-param-stripping rules in
`ruleset_url-tracking-extra.json` and AdGuard's URL Tracking filter itself — a
different `redirect.transform.queryTransform` shape, not `extensionPath`, and not
subject to the same "needs a resource file" constraint at all). **[measured]**

`rules/redirect-resources/` (the tracked-shape build output
`scripts/update-filters.mjs` writes the *needed* files into, line 441-443) contains
exactly 30 files — matching the 30 distinct resource names actually referenced.
**[measured]** `scripts/validate-rules.mjs` was also read in full: it validates rule
schema shape (only `id`/`priority`/`action`/`condition` keys, valid `action.type`
values, no duplicate ids, ruleCount-matches-manifest), but has **no logic specific to
`$redirect`/`extensionPath` rules at all** — it doesn't need to, because
`update-filters.mjs` already resolved or dropped them upstream of validation.
**[measured]**

Moat's own CHANGELOG.md (v0.7.5 entry, quoted in full above) independently confirms
this was a deliberate fix, not an accident: "confirmed live against the current rule
set: 0 of the 30 referenced files are missing," with the total rule count rising to
274,186 at that time from ~273,000 before the fix. The current total (this pass,
counted from `rules/dnr/manifest.json`) is 271,274 rules across 22 ruleset files — the
absolute number has drifted since (upstream list churn, plus later
consolidation/pruning work also mentioned in the changelog), but the resource-shipping
mechanism itself is unchanged. **[measured]**

### 4. `scripts/manifest.ts` and `scripts/build.mjs`: what's already wired, and MV3 constraints

**Already fully wired, not a gap.** `scripts/manifest.ts`'s `baseManifest()` declares:

```js
web_accessible_resources: [
  {
    resources: ["web-accessible-resources/redirects/*"],
    matches: ["<all_urls>"],
  },
  { resources: ["warning.html"], matches: ["<all_urls>"] },
  { resources: ["rules/consent-rules.json", "rules/ad-networks.json", "rules/seo-spam-domains.json"], matches: ["<all_urls>"] },
],
```

and for the Chrome target specifically (`buildManifest("chrome")`), every one of those
entries — including the redirects one — gets `use_dynamic_url: true` mapped on:

```js
web_accessible_resources: manifest.web_accessible_resources.map((entry) => ({
  ...entry,
  use_dynamic_url: true,
})),
```

Firefox's manifest does **not** get `use_dynamic_url` at all (it's absent from the
non-Chrome branch of `buildManifest`), with an explicit comment reasoning why: Firefox
already randomizes the per-install extension UUID by design, so the fingerprinting
concern `use_dynamic_url` addresses on Chrome doesn't apply there. **[measured]**

`scripts/build.mjs`'s `copyStaticAssets()` (lines 104-138) does the file-level wiring:
it throws a build-time error if `rules/redirect-resources` doesn't exist (forcing
`npm run filters:update` to have been run first), creates
`dist/<target>/web-accessible-resources/redirects/`, and `cpSync`s the resource
directory straight into it — so the `extensionPath` values already baked into the
compiled DNR rules (`/web-accessible-resources/redirects/<file>`) resolve as-is with no
rule rewriting needed. **[measured]**

On the MV3 constraints the task asked about, verified against Chrome's own current
docs (fetched live this pass):
- A `web_accessible_resources` entry must include `resources` and either `matches` or
  `extension_ids`; `matches` uses **origin-only** matching (subdomains included) —
  Moat's `<all_urls>` is the broadest legal value, not a workaround of a restriction.
  **[web]**
- `use_dynamic_url` exists specifically because "by default no resources are web
  accessible, as this allows a malicious website to fingerprint extensions... or
  exploit vulnerabilities" — when set, "a dynamic ID is generated per session... it is
  regenerated when the browser restarts or the extension reloads." **[web]**
- Chrome's `declarativeNetRequest` docs confirm the hard requirement Moat's build
  already satisfies: "A declarativeNetRequest rule cannot redirect from a public
  resource request to a resource that is not web accessible. Doing so triggers an
  error. This is true even if the specified web accessible resource is owned by the
  redirecting extension." **[web]**
- One thing this research could **not** confirm from Chrome's own docs: whether a
  `redirect.extensionPath` DNR rule automatically resolves to the *dynamic* per-session
  URL when its `web_accessible_resources` entry has `use_dynamic_url: true`, as opposed
  to only affecting resources a *page* fetches directly. Chrome's
  `declarativeNetRequest` reference page doesn't mention `use_dynamic_url` at all. Moat
  is already shipping `use_dynamic_url: true` on exactly this resource entry in
  production (confirmed by reading `manifest.ts`), so it evidently works, but this
  specific interaction isn't independently documented anywhere this research found —
  flagged in Confidence and gaps below rather than asserted.

### What this means for implementation (Question 1)

There is no implementation gap left to plan for on the current 30-resource,
11-ruleset scope: the resource files already live at
`node_modules/@adguard/scriptlets/dist/redirect-files/`, get filtered down to the
needed subset and copied to `rules/redirect-resources/` by
`scripts/update-filters.mjs`, get copied again into
`dist/<target>/web-accessible-resources/redirects/` by `scripts/build.mjs`, and are
already declared in `web_accessible_resources` (with Chrome-only `use_dynamic_url`) in
`scripts/manifest.ts`. The one real, actionable fact for any future work here: because
`@adguard/scriptlets` is a *transitive*, unpinned-by-Moat dependency, a future bump of
`@adguard/dnr-rulesets`/`@adguard/tsurlfilter` could silently change which
`@adguard/scriptlets` version (and therefore which resource filenames) ships — the
existing `droppedRedirectRules` counter and console warning in `update-filters.mjs`
already surface this if it ever happens (it would print
"`N $redirect rule(s) still dropped`" instead of staying silent), so the safety net is
already in place; there's nothing to build, only something to keep watching after
dependency bumps.

---

## Question 2: NextDNS's CNAME-cloak-destination list

### 1. Current state of the upstream list

Confirmed live via the GitHub API this pass: the list is still at
**`github.com/nextdns/cname-cloaking-blocklist`** (`gh api repos/nextdns/cname-cloaking-blocklist`),
description "A list of domains used by tracking companies as CNAME destination when
disguising third-party trackers as first-party trackers." **[web]**

- **License**: read the actual `LICENSE` file in the repo (not GitHub's license
  badge alone, though it agrees) — it is the **MIT License**, copyright "(c) 2022
  NextDNS." Full text confirmed via `gh api .../contents/LICENSE`. **[web]**
- **Update frequency**: the commit history (`gh api .../commits`) shows the **last
  commit to the `master` branch (the only branch) was `d86cbb9`, dated
  `2022-01-22T01:18:08Z`** — i.e. the list has not been touched in almost 4.5 years as
  of today (2026-09-12). The repo's own
  `pushed_at` metadata field says `2023-01-26T23:01:01Z`, which is later than the last
  commit on `master`; this research could not determine what that later push actually
  touched (possibly a non-code repo-settings change, a since-deleted branch, or a
  GitHub-side event unrelated to file content) since no commit after `d86cbb9` shows up
  in the branch's own history. Stated plainly rather than guessed at. **[web]**
- **File format**: confirmed by fetching the raw file
  (`raw.githubusercontent.com/nextdns/cname-cloaking-blocklist/master/domains`) directly
  — plain text, one bare domain per line, with `#`-prefixed comment lines (a company
  name and its homepage URL) interspersed as informal grouping/attribution, and blank
  lines between groups. No wildcard syntax, no `+` or leading-dot conventions — just
  bare registrable-or-subdomain hostnames (e.g. `eulerian.net`, `at-o.net`,
  `k.keyade.com`). The README states the list's entire operating assumption up front:
  "For this blocklist to work, the blocking logic must wildcard match (domain and all
  its multi-level subdomains) CNAMEs against the domains in this list." **[web]**
- **Current entry count**: **35 domains** (counted directly from the fetched raw file,
  excluding comment and blank lines). **[web]**

### 2. Where this plugs into Moat's existing CNAME-uncloaking flow

**It already is plugged in — this describes the existing wiring, not a proposed one.**
Read `src/background/cnameUncloakChrome.ts` and `src/background/cnameUncloakMatch.ts`
in full, plus (for completeness, since both files reference it) the Firefox path
`src/background/cnameUncloak.ts`.

`cnameUncloakMatch.ts` is pure matching logic shared by both browser paths:
- `isCandidateForUncloak(requestHostname, pageHostname)`: gates the *entire* feature to
  only requests whose hostname shares the current page's domain apex (via
  `domainChain(...).at(-1)`, a non-PSL-aware "last label pair" apex, an accepted
  imprecision the file's own comment documents) — this is the actual cloaking
  technique (disguise a third party as a same-site subdomain), so anything that
  doesn't share the apex is already visible to Moat's 271k static rules directly and
  never needs a DNS lookup.
- `isCnameCloakDestination` is literally **`export const isCnameCloakDestination = matchesKnownRedirectDomain;`** — a re-export of `redirectDomainMatch.ts`'s existing
  `matchesKnownRedirectDomain(hostname, domains)` function (the same function
  `athenaPolicySync.ts` and `popupGuard.ts` already use for a different domain set),
  aliased under a name that reads as what it means at each call site. It does simple
  domain-chain-walking set membership: true if `hostname` or any of its parent domains
  is in the `domains` set.

**The NextDNS list is the `domains` argument passed into `isCnameCloakDestination` at
runtime**, loaded from a bundled JSON file, not fetched live from GitHub. Both
`cnameUncloak.ts` (Firefox) and `cnameUncloakChrome.ts` (Chrome) have an identical
`loadCloakDestinations()` helper:

```ts
const url = browser.runtime.getURL("rules/cname-cloak-destinations.json");
const domains = (await (await fetch(url)).json()) as string[];
cloakDestinations = new Set(domains);
```

**Exact call sites:**
- Firefox (`cnameUncloak.ts`, real uncloaking via `browser.dns.resolve()`): in
  `onBeforeRequest`, after `isCandidateForUncloak` passes, it calls
  `resolveCanonicalName(requestHostname)` (Firefox's native, synchronous-capable
  `dns.resolve(hostname, ["canonical_name"])`) and checks
  `isCnameCloakDestination(canonical, destinations)` — a true match `cancel: true`s the
  request outright, inside the same blocking listener.
- Chrome (`cnameUncloakChrome.ts`, DoH-based approximation, since Chrome has neither
  `dns.resolve()` nor a blocking `webRequest` listener): in `handleBeforeRequest`,
  after the same `isCandidateForUncloak` gate, it calls
  `resolveCnameViaDoh(requestHostname)` (a `fetch()` to Cloudflare's
  `https://cloudflare-dns.com/dns-query` DoH endpoint) and checks the exact same
  `isCnameCloakDestination(canonical, destinations)`. A match doesn't cancel the
  current request (Chrome's non-blocking listener can't) — it calls
  `blockHostnameGoingForward(hostname)`, which adds a
  `declarativeNetRequest.updateDynamicRules()` block rule so *subsequent* requests to
  that now-confirmed-cloaked hostname are blocked at the network layer.

So: **it is not "a replacement for part of the current logic" nor a hypothetical
"additional signal layered on top" — it is the one and only source of the
`domains` set both real paths already gate their final decision on.** There is no
other tracker-domain source feeding this particular check today; the 271k static
DNR rules are a separate, independent blocking layer that CNAME uncloaking exists
specifically to catch what they miss (a disguised hostname the static rules never see
because it looks first-party).

### 3. Does Moat already vendor this list? From where, exactly?

**Yes, already vendored — confirmed by reading `scripts/vendor-cname-list.mjs` in
full**, referenced from `package.json`'s `filters:update` script
(`node scripts/vendor-cname-list.mjs`, one step in the chain alongside
`update-filters.mjs`, `update-cosmetics.mjs`, `vendor-consent-rules.mjs`, etc.).

It fetches exactly:
```
SOURCE_URL = "https://raw.githubusercontent.com/nextdns/cname-cloaking-blocklist/master/domains"
```
via a shared `fetchAndVendor` helper (`scripts/lib/vendorFetch.mjs`), parses it (split
on newlines, trim, drop blank/`#`-prefixed lines, sort), validates the result is
non-empty, and writes the parsed array to
**`rules/dnr/cname-cloak-destinations.json`**. The file's own header comment states the
license and scope explicitly: "Vendors NextDNS's public CNAME-cloaking destination
list (MIT-licensed... ) for Firefox-only CNAME uncloaking" and notes this list "only
refreshes when this script is re-run and a new build ships," unlike the
daily-polled `live/redirect-domains.json` mechanism used elsewhere in the codebase
(`background/liveUpdates.ts`) — a deliberate, stated scope reduction for "a niche,
opt-in, Firefox-only feature whose source list itself changes rarely." **[measured]**
(The comment predates the later Chrome DoH extension, but the vendoring mechanism and
output file are shared by both browser paths, per Q2.2 above.)

The vendored file currently on disk (`rules/dnr/cname-cloak-destinations.json` in the
build output) contains **35 domains** — read and counted directly. **[measured]**
This is an exact match to the 35 entries currently in NextDNS's own upstream `domains`
file (Q2.1) — Moat's vendored copy is fully current with upstream, unsurprising given
upstream hasn't changed since January 2022. **[measured]**

`scripts/build.mjs` copies `cname-cloak-destinations.json` into
`dist/<target>/rules/cname-cloak-destinations.json` alongside the other rule assets
(confirmed in the same `copyStaticAssets()` file list read for Q1.4), matching the
`rules/cname-cloak-destinations.json` path both `cnameUncloak.ts` and
`cnameUncloakChrome.ts` fetch via `runtime.getURL`. **[measured]**

### 4. GPL-3.0 / MIT compatibility

Moat's own `LICENSE` file (read directly) is the GNU GPL v3 full text, with the header
"Moat -- a quiet ad blocker and popup/redirect firewall for Chrome and Firefox.
Copyright (C) 2026 Samuelabhinav37" confirming `package.json`'s `"license": "GPL-3.0"`
field is accurate, not just a manifest claim. **[measured]**

NextDNS's list, per Q2.1, is genuinely **MIT-licensed** (verified from the actual
`LICENSE` file content in that repo, not assumed). The FSF's own license-compatibility
list (fetched live this pass, `gnu.org/licenses/license-list.html#Expat`) states
plainly: the Expat/MIT License is "a lax, permissive non-copyleft free software
license, compatible with the GNU GPL." **[web]** MIT-licensed data/code can be included
in a GPL-3.0 work; there is no compatibility problem, and Moat's own CHANGELOG.md
(v0.9.0 entry) already states this was checked at the time ("vendored from NextDNS's
public list... MIT-licensed").

### What this means for implementation (Question 2)

Again, no implementation gap: the list lives at
`rules/dnr/cname-cloak-destinations.json` (35 domains, currently in sync with
upstream), is fetched at runtime via `runtime.getURL("rules/cname-cloak-destinations.json")`
by both `cnameUncloak.ts` (Firefox, real `dns.resolve()`-based uncloaking) and
`cnameUncloakChrome.ts` (Chrome, DoH-approximation-based), and both check it through
the shared `isCnameCloakDestination`/`matchesKnownRedirectDomain` function. The one
concrete, actionable fact for future work: because upstream hasn't been touched since
January 2022 and `scripts/vendor-cname-list.mjs` only re-fetches on an explicit
`npm run filters:update` run (not automatically), there is no live-drift risk today,
but also no automatic detection if NextDNS's list quietly stops being maintained
entirely (e.g. repo archived) versus just staying genuinely stable — re-running
`filters:update` periodically and diffing the 35-domain count would be the only way to
notice either case.

---

## Confidence and gaps

- **Both "gaps" this doc was asked to verify are already closed in Moat's shipped
  source** (v0.7.5 for `$redirect` resources, v0.9.0+ for the NextDNS list). This is
  the single most important finding and should be treated as the headline, not a
  footnote, when this doc is used to inform any roadmap or implementation-planning
  conversation.
- **Not independently verified**: whether Chrome's `declarativeNetRequest`
  `redirect.extensionPath` resolution actually honors `use_dynamic_url` at the engine
  level (i.e., does the redirect target the per-session dynamic path or the static
  extension-ID path). Chrome's own `declarativeNetRequest` and
  `web_accessible_resources` reference docs (both fetched live this pass) don't state
  this explicitly either way. Moat ships this combination in production today
  (`manifest.ts` applies `use_dynamic_url: true` to the redirects resource entry for
  Chrome), so it evidently works in practice, but no primary source this research
  found documents the interaction directly — flagged rather than asserted.
- **Not independently verified**: the exact reason GitHub's `pushed_at` metadata for
  `nextdns/cname-cloaking-blocklist` (2023-01-26) postdates the last commit visible on
  its only branch, `master` (2022-01-22). Reported as an open discrepancy rather than
  explained away.
- **Not verified**: whether NextDNS maintains this list anywhere else in parallel (a
  private/updated internal version feeding their actual DNS product, separate from the
  public GitHub mirror). Nothing in the repo or NextDNS's public material this research
  found suggests that, but it also can't be ruled out from a public GitHub repo alone.
- **Scoped, not exhaustive**: rule/resource counts in this doc (997 extensionPath
  rules, 30 distinct resource files, 3,484 total redirect-action rules, 271,274 total
  DNR rules, 35 NextDNS domains) reflect the exact package versions and upstream list
  state present in this checkout on 2026-09-12 (`@adguard/dnr-rulesets@4.2.20260826030101`,
  `@adguard/scriptlets@2.4.2` transitively, NextDNS list at commit `d86cbb9`). Any of
  these will drift on the next `npm install` or `npm run filters:update` and would need
  re-counting, not re-assumed, the same way this doc's own numbers were produced by
  actually running resolution logic against the installed packages rather than reading
  package READMEs alone.

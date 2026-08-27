# Dead-rule pruning feasibility: can Moat identify and drop rules that never match anything?

Part 3 of the lightweight-architecture follow-up (after the "Lite" fresh-install preset,
v0.11.23, and the rule-consolidation spike, Part 2). The user approved investigating this with
one hard constraint: **zero telemetry collected from Moat's own users** -- no shipping a
match-counter, no phoning home real browsing data, even anonymized. Everything below either
cross-references already-published research/data or inspects `@adguard/dnr-rulesets`' own
package metadata; nothing here proposes collecting anything from Moat installs.

**Verdict up front: no direct implementation is actionable today.** The one real, usable
follow-up this surfaced is a build-process gap, not a filtering feature -- see Recommendation.

## Why this looked promising: "Who Filters the Filters"

Snyder, Vastel, and Livshits' *"Who Filters the Filters"* (arXiv:1810.09160, IMC 2020) crawled
real traffic against EasyList and found that **90.16% of its rules never matched anything** in
their crawl -- a striking number, and exactly the kind of finding that would justify pruning a
filter list aggressively without losing real coverage.

**That dataset was never released.** Checked directly for this spike:
- The arXiv listing carries no data-availability statement or supplementary-data link.
- The paper's own tooling repo, [`brave-experiments/brave-abp-measurer`](https://github.com/brave-experiments/brave-abp-measurer),
  is archived (read-only since April 2020) and its description ("ABP rule scraping code, with an
  eye towards lambda") confirms it's crawl/measurement infrastructure, not a published dataset of
  which rules matched what.

So there's no way to cross-reference Moat's bundled rules against this paper's actual findings --
only to cite the general finding that filter lists in this size range are known to carry a large
fraction of rules with little-to-no real-world hit rate.

## What AdGuard's own package metadata contains (and doesn't)

`@adguard/dnr-rulesets`' raw per-ruleset JSON embeds a `metadata` object on one sentinel rule per
file (Moat's own `ruleset_ads-1.json` rule id 1, the harmless `dummy.rule.adguard.com` rule, is
this exact carrier). Checked directly (`scripts/analysis/adguard-metadata-check.mjs`) against the
currently-installed package:

```
Metadata keys present: regexpRulesCount, unsafeRulesCount, rulesCount, ruleSetHashMapRaw, badFilterRulesRaw
```

`ruleSetHashMapRaw` is the interesting-looking one (73,914 entries for this one ruleset alone) --
but inspecting its shape shows it maps a hash (of the compiled rule, almost certainly for
provenance/dedup during AdGuard's own build) to `[sourceFileIndex, sourceLineNumber]` pairs. It's
**build provenance** -- which original filter-list line each compiled DNR rule came from -- not
usage telemetry. None of the five keys resemble a match count, a last-matched timestamp, or a
staleness flag. This confirms the package doesn't expose anything that would let Moat identify
dead rules on its own, with no further AdGuard involvement.

Also worth noting: **Moat's own build already discards this metadata.**
`scripts/update-filters.mjs` keeps only `{id, action, condition}` per rule when writing
`rules/dnr/*.json` -- verified directly, `ruleset_ads-1.json`'s shipped rule 1 carries no
`metadata` field at all. So even if this blob did carry something useful someday, Moat's pipeline
would need to change to keep it, on top of whatever AdGuard adds upstream.

## What actually helps: AdGuard runs this exact program themselves

AdGuard's own filter-compiler tooling includes an opt-in, off-by-default **"Tracking filter
rules statistics"** mechanism -- real users of AdGuard's own products who opt in have their
matched-rule data reported back to AdGuard's infrastructure, which AdGuard's filter maintainers
use to identify and remove rules that provide no real benefit. This is functionally the exact
research program Snyder et al. ran once, academically, in 2018 -- except AdGuard runs it
continuously, at far larger scale, on real traffic, with real user opt-in consent, as part of
maintaining EasyList/AdGuard Base/AdGuard Tracking filters.

**The practical consequence: Moat inherits this pruning automatically, for free, on every
`@adguard/dnr-rulesets` update** -- no telemetry, no code change, no opt-in flow of Moat's own
needed. Dead-rule pruning already happens; the only question is how quickly Moat's bundled copy
reflects it.

## The actual actionable finding: Moat's update cadence, not the rules themselves

Checked live for this spike: `@adguard/dnr-rulesets` publishes extremely frequently -- 29
releases in the `4.x` line alone (Moat's currently pinned major version) landed in the ~23 hours
between Moat's currently-locked version and the newest available one at the time of this check.
This isn't a one-off gap; `npm ci` (what CI runs) installs exactly what's frozen in
`package-lock.json`, and nothing currently updates that lock automatically:

- `.github/workflows/ci.yml` runs `npm ci` then `npm run filters:update` on every push -- but
  `filters:update` regenerates `rules/dnr/*.json` from whatever `@adguard/dnr-rulesets` version is
  *already installed*, it doesn't fetch a newer one.
- No `.github/dependabot.yml` or `renovate.json` exists anywhere in the repo -- confirmed by
  directory search. The dependency only advances when a human runs `npm install`/`npm update` and
  commits the resulting lockfile change.

Every hour that passes without that manual bump is an hour of upstream rule maintenance --
including whatever pruning AdGuard's own telemetry-driven process did -- that Moat isn't
carrying yet.

## Recommendation

Not a filtering-logic change: **add a scheduled dependency-update mechanism for
`@adguard/dnr-rulesets`** (Dependabot or Renovate, matching whichever this repo already leans
toward for other deps) so the package advances on a real cadence instead of only when someone
happens to run `npm install`. This is small, privacy-neutral, and orthogonal to everything else
in this three-part follow-up -- it doesn't require deciding anything about pruning strategy, it
just stops leaving already-published upstream improvements (pruning included) sitting unused.
Scoped as separate, smaller follow-up work, not part of this spike.

## Method

`scripts/analysis/adguard-metadata-check.mjs` (throwaway, not wired into the build):
1. Reads the installed `@adguard/dnr-rulesets` version from `node_modules`.
2. Queries the npm registry for every published version in the same major line, reports how many
   releases and how much wall-clock time separate the installed version from the newest.
3. Loads one raw (pre-Moat-processing) ruleset file from `node_modules` and reports its embedded
   `metadata` keys, flagging any that look usage/telemetry-shaped (none currently do).
4. Confirms Moat's own shipped `rules/dnr/ruleset_ads-1.json` carries no such metadata already.

Re-run it (`node scripts/analysis/adguard-metadata-check.mjs`, needs network access) any time for
a fresh reading -- the exact "N releases behind" number will differ every time it's run, since
this package publishes continuously.

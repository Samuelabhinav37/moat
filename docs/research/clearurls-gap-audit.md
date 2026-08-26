# ClearURLs gap audit: does Moat's URL-tracking-param stripping have real holes?

Item 11 of the [completeness/power plan](simplicity-and-completeness-review.md): compare
Moat's bundled tracking-parameter stripping against [ClearURLs](https://github.com/ClearURLs),
the reference implementation for this specific feature, and find concrete gaps -- not a
general "is ClearURLs better" comparison. This is research only; per the plan, code changes
are a separately-scoped follow-up, not part of this pass.

**Source data**: `https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json`,
fetched fresh for this audit (206 providers, 733 `rules` entries, 79 `exceptions`, 64
`redirections`, 9 `referralMarketing`, 4 `rawRules`, 10 `completeProvider` domains). Compared
against `rules/dnr/ruleset_url-tracking.json` (Moat's bundled "AdGuard URL Tracking filter",
904 DNR rules: one global `removeParams` rule with 311 generic params, plus 848 domain-scoped
rule groups covering 1796 unique param names in total -- sourced via
`scripts/update-filters.mjs`, not hand-maintained).

## Method

Extracted every literal (non-regex) parameter name ClearURLs strips, per provider, and
checked whether that exact string appears anywhere in Moat's bundled list -- either in the
311-param global rule, or in a domain-scoped rule for that provider. This is a coverage
floor, not a precise diff: it only proves a param is *missing*, since ClearURLs entries that
use regex character classes (`bi[a-z]*`, `gs_[a-z]*`) can't be string-matched this way and
were excluded from the "missing" count (they're a separate, structural gap -- see below).

## Finding 1 (structural, not fixable by adding rules): DNR can't express three of ClearURLs' four rule types

`declarativeNetRequest`'s `removeParams` only deletes query parameters by **exact literal
name**. ClearURLs' rule format has three additional mechanisms this can't replicate:

- **Regex-pattern parameter names** (106 of ClearURLs' 733 `rules` entries, ~14%) -- e.g.
  Google's `gs_[a-z]*` (`gs_lcp`, `gs_lcrp`, `gs_ssp`, ... — dozens of param variants under
  one pattern) or `bi[a-z]*`. `removeParams` needs each literal variant listed by name; a
  wildcard family can't be expressed at all, only individually discovered instances.
- **`redirections`** (64 entries) -- extracting a target URL from a wrapper param and
  navigating there directly, e.g. Google's `/url?q=<target>` search-result redirector or
  `t.co`-style shorteners. DNR's `regexSubstitution` redirect action *can* technically do
  capture-group URL rewrites, but that's a fundamentally different rule shape than
  `removeParams`, unused anywhere in Moat's current bundled rules -- adopting it would be new
  ruleset-generation logic, not a data update.
- **`rawRules`** (4 entries) -- arbitrary regex substitutions on the full URL, ClearURLs'
  escape hatch for cases the structured fields can't express. No DNR equivalent exists.

None of this is a bug to fix; it's a ceiling on what a `removeParams`-based DNR ruleset can
ever match, regardless of how current the param list is kept. Noting it so a future "why
doesn't Moat strip Google's `gs_lcp=...`" report isn't mistaken for a data gap.

## Finding 2 (structural, likely not worth closing): 10 ClearURLs `completeProvider` domains

ClearURLs fully blocks 10 domains outright rather than stripping params (`googlesyndication`,
`amazon-adsystem`, `adtech`, `bf-ad`, `adsensecustomsearchads`, `youtube_pagead`,
`youtube_apiads`, `fls-na.amazon`, plus 2 test-only entries). This isn't Moat's URL-tracking
list's job -- full-domain ad/tracker blocking is what `ruleset_ads-*` and `ruleset_trackers-*`
already do. Spot-checked `googlesyndication.com` and `amazon-adsystem.com`: both are covered
by AdGuard's Base/Tracking filters already bundled. Not pursuing individual verification of
all 10 -- if any turn out to be gaps, they belong in the ads/trackers rulesets' own upstream
AdGuard source, not a change to `ruleset_url-tracking.json`.

## Finding 3 (real, material gap): high-traffic first-party pages are under-covered

Moat's bundled list is broader than ClearURLs' in raw size (1796 vs. ClearURLs' ~627 literal
param names) because AdGuard's source list has far deeper long-tail domain coverage --
hundreds of smaller retailers, regional sites, and affiliate networks ClearURLs doesn't list
at all. But checking specifically against the **highest-traffic** first-party domains people
actually browse -- not third-party ad networks, the actual search-results/post/product pages
-- found real, literal-string gaps Moat doesn't strip on any matching rule:

| Domain | Missing params (literal, verified absent from Moat) |
|---|---|
| `google.*` (search results) | `esrc`, `uact`, `cd`, `cad`, `atyp`, `vet`, `_u`, `je`, `dcr`, `ie`, `sei`, `dpr`, `usg`, `sxsrf`, `rlz`, `ictx`, `cshid`, `i-would-rather-use-firefox` |
| `facebook.com` | `eid`, `comment_tracking`, `dti`, `app`, `video_source`, `ftentidentifier`, `pageid`, `padding`, `ls_ref`, `action_history`, `referral_code`, `referral_story_type`, `eav`, `sfnsn`, `idorvanity`, `wtsid`, `rdr`, `paipv`, `_nc_x`, `_rdr` |
| `amazon.*` (product/search pages) | `spIA`, `ms3_c`, `qualifier`, `_encoding`, `aaxitk`, `hsa_cr_id`, `rnid`, `content-id`, `social_share`, `starsLeft`, `skipTwisterOG` |
| `bing.com` | `sp`, `qs`, `qp` |
| `twitter.com` / `x.com` | `cn` |
| `reddit.com` | `rdt` (Moat already strips `entry_point`, `target_user`, `share_id`, `ref`, and 6 others here -- this is the one it misses) |
| `twitch.tv` | `tt_medium`, `tt_content` |
| `youtube.com` | `kw` |

Google and Facebook account for the large majority of this list. Both are sites nearly every
user visits daily, so the practical exposure is disproportionate to the raw count -- these
are exactly the domains where a tracking-param leak (via copy-pasted link, screenshot, or
shared URL) is most likely to happen in practice.

Two entries deserve a caveat before anyone turns this into rules: `ie` (input encoding) and
`dpr` (device pixel ratio) on Google are not obviously tracking-only by name alone --
ClearURLs strips them and the upstream project has presumably verified they're safe to drop,
but Moat's own rule-generation should independently confirm before bundling (same standard
`scripts/update-filters.mjs` already applies to AdGuard's source lists).

Also noted but not tabulated above: ClearURLs' two `globalRules` regex entries
(`(?:%3F)?ref_?`, `(?:%3F)?referrer`) match `ref`, `ref_`, and anything containing
`referrer` on *any* domain. Moat's 311-param global list deliberately doesn't include a bare
`ref`/`referrer` strip -- likely correct caution, since `ref` is a genuinely ambiguous
generic query param name on many non-tracking sites (documentation anchors, redirect
targets), not a case to blindly copy.

## Recommendation

Concrete, material gap confirmed (Finding 3) -- but per the plan, this audit stops here.
Adding these as new domain-scoped `removeParams` rules (most likely appended to
`ruleset_url-tracking.json` or a small new supplemental ruleset, following the exact shape
already used for the 848 existing domain-scoped groups) is real, scoped, low-risk follow-up
work -- but it's follow-up, not part of this pass. Findings 1 and 2 are not code work at all;
they're documentation of a structural ceiling worth knowing about the next time someone asks
"why doesn't this catch X."

# DNR rule consolidation audit: how much of Moat's rule count is compressible?

Part 2 of the lightweight/rule-budget follow-up (after the "Lite" fresh-install preset,
v0.11.23): the user approved investigating regex/wildcard rule consolidation as an R&D spike
after asking how other ad blockers stay lightweight. This is research only -- the script behind
it (`scripts/analysis/consolidation-audit.mjs`) is a throwaway analysis tool, not wired into the
build, and nothing here changes what ships. Re-run it any time the bundled rulesets update
(`@adguard/dnr-rulesets` bumps roughly weekly) to get fresh numbers.

**Source data**: Moat's own bundled `rules/dnr/*.json` (196,927 rules across the 12 rulesets
whose `category` isn't `security`; see "Why security is excluded" below) plus a live fetch of
the real [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) (10,240
suffix rules, 8 exceptions, fetched fresh for this audit).

## The actual mechanism: no regex needed at all

The premise going in was "regex/wildcard consolidation" -- but `declarativeNetRequest`'s `||`
domain-anchor syntax already does this for free: `||example.com^` matches `example.com` **and
every subdomain of it** (`track.example.com`, `a.b.example.com`, ...). No wildcard or regex rule
is needed to cover a whole domain family; a single anchored rule already does. So "consolidation"
here isn't about inventing new DNR syntax -- it's about noticing when the *existing* rule set
already has (or could have) one rule doing the job of several.

That reframes the question into two genuinely different findings, with very different risk
profiles.

## Finding 1: already-redundant rules (safe, zero behavior change)

A rule blocking `sub.example.com` is dead weight if another rule *in the same ruleset* already
blocks an ancestor domain (`example.com`) with an equal-or-broader `resourceTypes` set --
`||example.com^` already matches `sub.example.com`, so the child rule blocks nothing extra.
Removing it changes nothing about what actually gets blocked; it's the same category of
optimization AdGuard's own upstream compiler is expected to have mostly already made, so a low
number here would be the *expected* result, not evidence of a bug.

**Result: 3,011 of 161,835 simple domain-block rules (1.86%) are already-redundant this way.**
Real, free, essentially zero risk -- but small. Most of it (2,972 of the 3,011) is concentrated
in a single file, `ruleset_ads-1.json`; the four `trackers-*`/`ads-2` files each have single or
double digits. This is consistent with upstream (AdGuard's compiler) already doing most of this
work already, and Moat inheriting whatever's left.

## Finding 2: sibling-subdomain consolidation (real opportunity, but not a pure optimization)

The bigger number: group the *non*-redundant simple domain-block rules by real registrable
domain (via the PSL, not a naive last-two-labels split -- see below) and look for registrable
domains with many individually-blocked subdomains but no rule for the apex domain itself.

**Result: 767 groups (≥5 sibling subdomains each) covering 8,326 rules.** Collapsing each group
to one apex rule would take those 8,326 rules down to 767 -- a reduction of 7,559 rules, roughly
**4% of the 196,927-rule scanned total**, concentrated in `ads`/`trackers` specifically (the two
largest categories). Top examples from the real data: `notifysrv.com` and `notify6.com` (both
ad-tech infrastructure domains, 467 and 466 sibling subdomain rules respectively -- almost
certainly a single vendor rotating subdomains to dodge exact-match filters), `mydays.de` and
`adobe.com` (200+ each, both trackers), `iocnt.de`, `vgwort.de`, `easyjet.com`, `anwalt.de`,
`rewe.de`, `experian.com` (dozens each).

**This is not a free win, unlike Finding 1.** Replacing 467 explicit `notifysrv.com` subdomain
rules with one `||notifysrv.com^` rule doesn't just save 466 rules -- it also starts blocking
*every other* current or future subdomain of `notifysrv.com`, including ones nobody has verified
belong to the same tracker/ad infrastructure. For a single-owner ad-tech domain that's almost
certainly fine and arguably an *improvement* (catches subdomain rotation before it needs a new
rule). But it's a real behavior change a machine can't safely make unsupervised from rule-count
data alone -- it needs either domain-ownership confirmation (e.g. cross-referencing
`@ghostery/trackerdb`, which Moat already vendors for company attribution) or trusting that
upstream (AdGuard/EasyList) already vetted it before writing 467 separate rules instead of one.
Turning this into a shipped feature is future scope, not something this spike concluded should
happen automatically.

## Why the real Public Suffix List matters here, not a naive domain split

A naive "last two labels" grouping (`sub.example.co.uk` → `co.uk`) fails in two concrete ways
this audit specifically had to avoid:

1. **Multi-label ccTLD suffixes aren't registrable domains.** `co.uk`, `com.br`, `com.au`,
   `co.jp` would each become a false "single owner" bucket grouping every unrelated `*.co.uk`
   site in the data as if they were siblings.
2. **Shared-hosting platforms aren't single owners either**, and this one isn't hypothetical --
   Moat's bundled rules genuinely contain `github.io`, `blogspot.com`, `vercel.app`,
   `netlify.app`, and `wordpress.com` subdomains (verified: `bp.blogspot.com`,
   `googleads.github.io`, `*.vercel.app`, `*.netlify.app` all appear in `ruleset_ads-1.json`).
   Grouping `alice.blogspot.com` and `bob.blogspot.com` as "siblings" and consolidating them into
   a rule blocking all of `blogspot.com` would block every blog on the platform. This is the
   exact same trap `scripts/update-filters.mjs`'s own company-attribution code already had to
   guard against for the security category (its comment: "chain-walking those up to the
   platform's own registrable domain would misattribute the block").

The real PSL handles both correctly because it lists `blogspot.com`/`github.io`/etc. in its
"private" section as suffixes in their own right, exactly like `co.uk` is in its "ICANN" section
-- so the algorithm treats `alice.blogspot.com` as *itself* a registrable domain, not a subdomain
of a `blogspot.com` "owner". Verified directly against the loaded PSL data for this audit:

```
blogspot.com        -> null (is itself a suffix, excluded from grouping)
alice.blogspot.com  -> alice.blogspot.com (its own registrable domain)
bob.blogspot.com    -> bob.blogspot.com (different from alice's -- never grouped together)
example.co.uk       -> example.co.uk (correct; naive split would say "co.uk")
www.example.co.uk   -> example.co.uk (correctly grouped with the line above)
track.example.com   -> example.com
```

In this run, none of the actually-qualifying "simple domain-block" rules happened to be a bare,
condition-free rule for exactly a shared-hosting domain (the real `blogspot.com`/`github.io`
entries in the data all carry extra `initiatorDomains` conditions, which the simple-block filter
already excludes for an unrelated reason -- see Method). So the PSL suffix-exclusion path didn't
get exercised by real data in this particular snapshot; it's confirmed correct by direct testing
above, not by a real near-miss this run happened to catch. Worth keeping regardless, since
today's rulesets not exercising it doesn't guarantee tomorrow's won't.

## Method

`scripts/analysis/consolidation-audit.mjs`:

1. Reads `rules/dnr/manifest.json`, scans every ruleset whose `category` is not `security`
   (malicious-urls/phishing-urls/scam/badware rulesets block arbitrary hosted bad content, often
   on shared platforms -- consolidating those by domain risks misattributing the block to the
   platform, same reasoning as the company-attribution code cited above; out of scope here).
2. A rule qualifies as a "simple domain block" only if `action.type === "block"` and its
   `condition` is *exactly* `{ urlFilter: "||domain^", resourceTypes: [...] }` -- no
   `initiatorDomains`, `domainType`, or anything else. Rules with extra conditions are excluded
   outright rather than guessed at, since a naive domain merge would silently drop that extra
   semantics.
3. Finding 1: for each qualifying rule, walk its domain's ancestors and check whether another
   qualifying rule in the *same file* already blocks one, with an identical `resourceTypes` key.
4. Finding 2: group the leftover (non-redundant) rules by real registrable domain (PSL-based, per
   above), report groups of 5+ siblings.

Numbers are reproducible: `node scripts/analysis/consolidation-audit.mjs` (needs network access
for the live PSL fetch; full per-ruleset breakdown and the top 50 candidate groups are written to
`scripts/analysis/consolidation-audit-results.json`, gitignored-by-convention scratch output, not
committed).

## Verdict

- **Finding 1 (already-redundant rules) is a legitimate, zero-risk future cleanup** -- small
  (1.86% of simple blocks, ~3,000 rules) but genuinely free. Worth a follow-up pass at some
  point; not urgent on its own given the size.
- **Finding 2 (sibling-subdomain consolidation) is the more interesting number** (~4% of the
  scanned rule count) but is explicitly **not** being turned into an automatic build step by this
  spike -- it's a real behavior change (broadens blocking scope for hundreds of domains) that
  needs domain-ownership confirmation Moat doesn't currently have a source of truth for beyond
  "AdGuard/EasyList wrote it this way." A future pass could cross-reference `@ghostery/trackerdb`
  company data for the largest groups (`notifysrv.com`, `adobe.com`, etc.) as a confirmation
  signal before ever auto-generating a consolidated rule.
- Neither finding, even combined (~5.9% reduction), meaningfully changes the rule-budget math
  from the "Lite" preset work -- Moat's rule count is dominated by breadth of coverage (188k+
  ads/tracker rules), not redundancy within it. This spike's conclusion is that consolidation is
  a real, bounded, low-risk-when-done-carefully cleanup, not a lightweight-architecture strategy
  on the scale of shrinking the default tier was.

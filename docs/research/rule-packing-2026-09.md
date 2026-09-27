# Packing domain rules: same blocking, a quarter of the rules (2026-09-27)

## The problem

Chrome's static-rule limit (330,000) is shared by every extension, and Chrome compiles all enabled
rules at install, update and startup. Moat shipped 313,889 rules (94% of the limit), and started
in 3.6 s against uBlock Origin Lite's 1.2 s (`test-audit-2026-09.md`).

Chrome, not Moat, matches requests, through an index over the rules' URL patterns, so the number
of rules barely affects per-request cost. What it does cost is compile time, the compiled index's
size (memory and disk), package size, and room under the shared limit. The goal is fewer rules for
the same blocking, not choosing rules per page, which DNR doesn't allow anyway.

## What the rules were

- 247,949 of 313,889 rules (78%) were plain `||domain^` blocks, one domain each.
- They fell into 50 shapes (resourceTypes, domainType, priority).
- 10,034 domains appeared in more than one list; 2,135 were subdomains of a blocked domain.
- 4,314 of them carry a company attribution (`rule-companies.json`).

## What changed

`scripts/pack-rules.mjs` (in `npm run filters:update`) packs each ruleset's plain domain blocks
into `requestDomains` rules, which match a listed domain or any subdomain, exactly like `||domain^`.
Only rules identical apart from the domain are packed together; every other rule, and every rule a
company is attributed to, keeps its form and id (`scripts/lib/packDomainRules.mjs`). Packing is per
ruleset, so turning a list on or off works as before.

313,889 rules -> 71,771. Settings shows filter entries (313,889) for the lists and About, and the
real rule count (71,771) on the Chrome budget line.

## Domains per packed rule

A rule with only a domain list has no URL pattern to index, so Chrome checks every such rule on
each request (inside a rule the domain lookup is a binary search). So the fewer packed rules the
better. 50,000 `testMatchOutcome` lookups, best of 3 passes, median of 3 fresh installs
(`scripts/benchmark/rules-cost.mjs`):

| Build | Rules | Rule files | Rules ready | Compiled index | 50,000 lookups |
|---|---|---|---|---|---|
| Original | 313,889 | 52.8 MB | 3.14 s | 38.1 MB | 7.61 s |
| 500 domains / rule | 72,244 | 21.1 MB | 1.70 s | 17.7 MB | 16.76 s |
| 5,000 domains / rule | 71,811 | 21.1 MB | 1.67 s | 17.7 MB | 9.45 s |
| **50,000 domains / rule (shipped)** | **71,771** | **21.1 MB** | **1.89 s** | **17.7 MB** | **7.77 s** |

No group inside one ruleset file reaches 50,000, so this is one rule per group; lookup cost is
level with the original (within run-to-run noise).

## Proof that nothing is blocked differently

`scripts/check-rule-packing.mjs` loads the packed build and the same build with the original rules
into Chrome for Testing, turns every ruleset on in both, and asks Chrome
(`declarativeNetRequest.testMatchOutcome`) about requests to every domain any rule names: a
subdomain from a third-party page and the domain from its own site, across ten request types.

Full run: 263,533 domains, 527,066 requests per build, **0 differences, 0 errors** (438,398 blocks,
119 allows, 55 redirects, 5 allow-all, the rest header rules; all identical). CI runs it on every
20th domain.

Live benchmark (`scripts/benchmark/bench.mjs moat`): 130/131 test hosts blocked (same miss,
`udc.yahoo.com`), 4 ad slots left on the eight sites (identical per site), startup 1.6 s (was 3.6 s).
Cloudflare Turnstile passed 2/3 in that run; repeated separately, 8/8 packed, 7/8 original rules,
8/8 with no extension, and nothing blocked on the page by either build, so it's the live service.

## Phase 3: daily security lists (0.11.156)

The phishing, malicious-URL and scam lists are refreshed daily from their upstream sources and
applied as a few packed dynamic rules next to the bundled ones. See CHANGELOG 0.11.156,
`src/shared/liveSecurity.ts` (guardrails) and `.github/workflows/security-live.yml`.

## Phase 2: do the remaining pattern rules earn their place?

`scripts/benchmark/crawl-rule-hits.mjs` loaded Moat with the original rules and every list on,
and counted every rule Chrome reported firing (`onRuleMatchedDebug`) on the homepages of the
Tranco top sites. The run was stopped at 600 of 1,000 (the machine ran low on memory); 311 of the
600 loaded as web pages (the rest are infrastructure domains like gstatic.com or akamai.net).
`scripts/benchmark/analyze-rule-hits.mjs`:

| Kind | Fired | Total |
|---|---|---|
| Pattern block rules | 229 | 55,758 (0.4%) |
| Domain rules | 321 | 246,508 |
| Exceptions (allow) | 64 | 8,116 |
| Redirects (stubs) | 19 | 3,485 |
| Header rules | 5 | 22 |

Most pattern rules are the security lists' phishing and malware URL rules (36,000), which should
never fire on a popular legitimate homepage; that says nothing about their value, so they were not
candidates. Exceptions and redirects exist to stop breakage and stay regardless.

The candidates were the 18,081 ad/tracker/annoyance pattern rules that never fired. A what-if build
without them (`TRIM=.cache/crawl/cold-rules.json node scripts/benchmark/rules-cost.mjs`):

| Build | Rules | Rules ready | Compiled index | Rule files |
|---|---|---|---|---|
| Original | 313,889 | 3.73 s | 38.1 MB | 52.8 MB |
| Packed (shipped) | 71,771 | 2.08 s | 17.7 MB | 21.1 MB |
| Packed + cold patterns removed | 53,690 | 1.90 s | 15.2 MB | 18.7 MB |

(A busier machine than the earlier table, so all times are higher; compare rows.)

**Decision: not trimmed.** Removing them would save about 0.2 s and 2.5 MB on top of the 1.6 s and
20 MB packing already saved, while the crawl only saw homepages of popular sites, from one US
connection, logged out. Pattern rules are the long tail (article pages, smaller and regional
sites), exactly what a homepage crawl can't see. Revisit only with a crawl of inner pages across
regions, and then as "move to Strict", not deletion.

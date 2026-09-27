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

## Not done here

- Company attribution is kept by not packing attributed rules. Packing trackers per company would
  pack those too, at the cost of one scanned rule per company.
- Pattern rules (about 66,000) are unchanged. Trimming ones that never fire needs a hit-rate crawl
  and a decision about moving them to Strict; see the plan in the conversation that led here.
- Security lists (phishing, scam, malware) could now be shipped as a few packed dynamic rules
  refreshed daily through the signed live-update channel.

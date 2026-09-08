# Moat's blocking algorithm: where the cost is, how the field keeps it low, and how it behaves on many machines at once (2026-09)

Four questions:

1. What algorithm does Moat actually run to block a page, and where does the cost land?
2. How do the other blockers keep per-page cost down?
3. Concrete changes to make each block cheaper / faster / lighter.
4. If Moat runs on many machines simultaneously, does anything degrade?

**Not re-covered** (settled in the corpus, cross-referenced instead of repeated):

- The MV3 engine comparison across uBO/uBOL/AdGuard/Brave/Ghostery/Privacy Badger — rarest-token
  bucketing, the hostname trie/WASM, class/id cosmetic sharding —
  [`ad-blocker-architecture-and-roadmap.md`](ad-blocker-architecture-and-roadmap.md) §1.
- The measured resource footprint and the 9 "Candidates for Moat" reconciliation —
  [`data-usage-optimization-ui-user-demand-2026-09.md`](data-usage-optimization-ui-user-demand-2026-09.md)
  §1–§3. **§2 item 6 already flags the generic-cosmetic surveyor as "genuinely still open"** — this
  doc turns that into a concrete plan with current numbers.
- The cosmetic-trim jank fix (v0.11.27) — [`deep-review-findings.md`](deep-review-findings.md) Finding 1.
- Dead-rule pruning (blocked: the "Who Filters the Filters" dataset was never released) —
  [`dead-rule-pruning-feasibility.md`](dead-rule-pruning-feasibility.md).

Confidence: **[measured]** = read/counted against the current build this pass; **[web]** = live
search this pass; **[general]** = established background.

---

## Part 1 — What Moat actually runs, and where the cost is

### 1.1 Network blocking: **Moat runs no matching code at all**

The 20 static rulesets (**271,270 rules [measured]**) are handed to the browser's native
`declarativeNetRequest` engine. Chromium indexes them once at ruleset load into a flatbuffer
reverse index keyed on the rarest n-grams of each `urlFilter` — the same "rarest token" idea uBO
pioneered, but in C++, built once **[general]**. Per request: a few hash lookups + a candidate
check, in the network stack, off the page's main thread. It does **not** scale with total rule
count in any way a user can feel.

Rule-shape breakdown of Moat's 271,270 **[measured]**:

| action | count | note |
|---|---|---|
| `block` | 259,646 (95.7%) | the cheapest, most-indexable kind |
| `allow` / `allowAllRequests` | 8,116 | exception rules |
| `modifyHeaders` | 24 | negligible |
| other | ~3,484 | |
| `regexFilter` (any action) | 262 | well under the 1,000 combined cap |

This is close to the best case for a DNR ruleset: almost entirely plain `block`, trivial regex,
almost no header modification. **There is no meaningful per-request optimisation left for Moat to
make here** — the algorithm belongs to the browser.

### 1.2 Per-page runtime cost: the content scripts, dominated by cosmetic filtering

This is the only part that runs on **every user's machine, on every page load**, whether or not
anything gets blocked. From the built Chrome manifest **[measured]**:

| script | world | run_at | scope | bundle |
|---|---|---|---|---|
| `main-world-guard.js` | MAIN | document_start | `<all_urls>` | 2.0 KB |
| `fingerprint-guard.js` | MAIN | document_start | `<all_urls>` | 3.0 KB |
| `bridge.js` | ISOLATED | document_start | `<all_urls>` | 19.6 KB |
| `cosmetic-filter.js` | ISOLATED | document_start | `<all_urls>` | 14.7 KB |
| `element-picker.js` | ISOLATED | document_idle | `<all_urls>` | 13.9 KB |
| `consent-rejector.js` | ISOLATED | document_idle | `<all_urls>` | 18.4 KB |
| `leaked-password-check.js` | ISOLATED | document_idle | `<all_urls>` | 13.5 KB |
| `youtube-ad-dimmer.js` | ISOLATED | document_idle | YouTube only | 13.0 KB |
| `feed-ad-scanner.js` | ISOLATED | document_idle | IG/LI/YT only | 13.1 KB |

**Six always-on scripts** parse + execute on every page. The dominant cost is `cosmetic-filter.js`
and what it fetches:

- **`cosmetics-meta.json` — 529 KB, fetched on every page load [measured].** It holds the flat
  array of **17,148 generic selectors** + 3,821 exception domains + 5 generic-injection rules.
- **1–3 domain-hash buckets** (64 total, avg **108 KB [measured]**) selected by
  `shardIndicesForHostname` (FNV-1a of each domain-chain label mod 64).
- So a typical page fetches **~640–850 KB of cosmetic JSON**, `JSON.parse`s it on the page thread
  (~2–5 ms for the 529 KB alone), builds a `<style>` batching selectors 2,000-per-rule, and
  injects it at `document_start`.
- All **17,148 generic selectors stay live in the style engine from `document_start` until
  `load`**, when `trimUnmatchedGenericRules` prunes the ones that matched nothing (batched
  200-per-idle-slice since v0.11.27). `deep-review-findings.md` measured the *trim* pass at ~560 ms
  on an 800-element page; the initial inject-all is the same order and is paid every navigation.

`popupGuard` (a `webNavigation.onCreatedNavigationTarget` listener doing a `Set` lookup over
~2,600 baseline + ~460 live redirect domains, walking the domain chain — O(labels) per new tab)
and `fingerprint-guard` are cheap. The build pipeline (`update-filters.mjs` /
`update-cosmetics.mjs`, ~190k+ rules) runs on CI, never on a user's machine.

**Verdict:** the network algorithm is at the ceiling; **all the runtime headroom is in the
per-page content-script work, and ~90% of that is the cosmetic path — specifically the 529 KB
generic array shipped to, parsed by, and style-recalc'd on every page.**

---

## Part 2 — How the field keeps per-page cost down

**[web + general]**

| technique | uBO (MV2) | uBOL (MV3) | AdGuard | adblock-rust (Brave) | Moat today |
|---|---|---|---|---|---|
| **Inject via a user-origin stylesheet** (`insertCSS` `cssOrigin:"user"`), batched, browser-managed | yes (`vAPI.userStylesheet`) | yes (`insertCSS` from the SW, per site) | yes | yes | **no** — a content script `fetch`es JSON and sets `<style>.textContent` on the page thread |
| **Only inject where there's something to do** | n/a (single CS) | **yes** — `scripting.registerContentScripts` per hostname that has rules; a site with none gets no script | partial | yes | **no** — `cosmetic-filter.js` on `<all_urls>`, full fetch every page |
| **DOM surveyor for generics** — after DOM ready, collect the `class`/`id` tokens present, look them up in a `Map<token, selectors>`, inject only those; re-check on throttled mutations | **yes** — "a typical generic cosmetic filter only injects when the surveyor finds a matching element" | bounded generic set only | yes | yes | **no** — ships all 17,148 generics to every page, injects all, trims after `load` |
| **Generic split into low (1-token, hash-looked-up) / high (complex, tiny wholesale set)** | yes | — | yes | yes | **no** — one flat array |
| **Per-hostname specific selectors from a compact typed-array DB** | yes | build-time per-host CSS files | yes | yes | **partial** — 64 domain-hash buckets (better than "all per-domain to every page", worse than exact per-host) |

The two Moat is missing outright — **user-origin `insertCSS`** and **DOM-surveyor gating** — are
exactly the two that remove the 529 KB fetch and the 17k-selector recalc.

---

## Part 3 — Concrete changes, ranked by (win ÷ effort)

### A. DOM-surveyor gating for generic selectors  — biggest single win

**Build side (`update-cosmetics.mjs`):** instead of `cosmetics-meta.json`'s flat `generic: string[]`,
emit `genericByToken: Record<tokenHash, number[]>` — for every generic selector, the class/id
tokens it *could* match on (parse the selector for `.foo` / `#bar` leading tokens; selectors with
no such anchor go into a small "generic-high" wholesale set, expected to be a few hundred, not 17k).
Ship the token map + the small high set; drop the 17k array.

**Runtime (`cosmetic-filter.js`):** at `document_end` (DOM available), one pass —
`for (const el of document.querySelectorAll('[class],[id]'))` collect the token set (or a
`TreeWalker` over element nodes reading `classList` + `id`); for each present token, union its
generic selectors; inject only those + the generic-high set. Re-run on a **throttled**
`MutationObserver` (attributes: `class`/`id`, childList) for tokens that appear later — same
budgeted-idle-slice discipline the current trim already uses.

**Effect:** `cosmetics-meta.json` drops from 529 KB to a token map that's far smaller and only
partially fetched; the style engine evaluates *dozens* of generic selectors instead of 17,148;
the post-`load` trim disappears (you never over-inject). This is the change
`data-usage-optimization-ui-user-demand-2026-09.md` §2 item 6 named as still-open.

**Cost:** medium-large. Touches `update-cosmetics.mjs`, `cosmeticSelectors.ts` (new lookup +
surveyor), `cosmeticFilter.ts` (call order), and the exception logic (`excludedForChain` must
still apply). The existing `cosmeticSelectors.test.ts` gives a safety net for the pure parts.

### B. Move injection to `scripting.insertCSS` from the service worker

On `webNavigation.onCommitted`, the SW computes the domain's selector set (the same pure
`domainSelectorsForHostname` / `customSelectorsForHostname` functions — they don't need the DOM)
and calls `chrome.scripting.insertCSS({ target: { tabId }, css, origin: "USER" })`. No page-thread
`fetch`, no `JSON.parse` on the page, no content-script `<style>` build; the browser owns the
stylesheet and applies it efficiently. The content script is then only needed for the **A**
surveyor and for procedural / `#$#` injection rules.

**Cost:** medium. Some care around timing (insert before first paint — `onCommitted` fires early
enough; `insertCSS` on a not-yet-loaded tab is queued). Firefox parity: `browser.tabs.insertCSS`
with `cssOrigin: "user"` is the MV2-era equivalent and still supported.

### C. Skip the cosmetic content script where there's nothing to do

Bundle a compact "domain has per-domain rules" structure — a sorted eTLD+1 list or a bloom filter
over the **52,716** rule-bearing domains (`validate-rules` output), ≈ 50–150 KB. The CS returns in
< 1 ms if the domain isn't in it *and* (post-**A**) the surveyor finds no generic tokens on the
page. Or, cleaner, `chrome.scripting.registerContentScripts` with a `matches` pattern set derived
from the buckets, so the browser doesn't even load the script on a bare domain.

**Cost:** small-medium (needs the bundled set + a fast membership check; `registerContentScripts`
has a per-extension registered-script and match-pattern budget to respect).

### D. Load `element-picker.js` on demand, not on every page

It's only needed when the user activates the picker. Inject it via
`chrome.scripting.executeScript({ target: { tabId }, files: ["element-picker.js"] })` from the
popup on click. Removes a 13.9 KB parse + execute from **every** page load.

**Cost:** small.

### E. Gate `leaked-password-check.js` and `consent-rejector.js`

- `leaked-password-check`: early-return unless `document.querySelector('input[type=password]')`
  (cheap; today it runs full logic on every page). Better: only register it for pages with a
  password field isn't expressible in `matches`, so the early-return is the pragmatic form.
- `consent-rejector`: only known-CMP domains. Reuse the **C** bundled-set pattern with a CMP-domain
  list (a few thousand entries).

**Cost:** small each.

### F. Network side — leave it

96% plain `block`, 262 regex (cap 1,000), 24 `modifyHeaders`. The one-time index build for 271k
rules is tens of ms and a few MB of memory. The **Lite preset (~85k rules)** already exists for
low-end machines. Dead-rule pruning stays blocked. No change worth making.

**Rough combined effect of A + B:** a typical page's cosmetic cost drops from "~640–850 KB fetched
+ 17k selectors recalc'd + a post-load trim" to "a small token-map lookup + a few dozen selectors,
applied by the browser as a user stylesheet". That is most of Moat's per-page runtime cost.

---

## Part 4 — Running on many machines at the same time

**It is the default, and it costs nothing extra. The algorithm is parallel by construction.**

| component | where it runs | shared with other machines? |
|---|---|---|
| DNR rule index (271k rules) | each browser, built **once** at extension load from the bundled rulesets, natively (~tens of ms, a few MB) | **no** — no server matching, no shared index, no coordination |
| Per-request network match | the browser's network stack, per machine | **no** |
| Cosmetic filtering | the page thread, per page, per machine | **no** |
| popupGuard / fingerprint guard | the service worker, per machine, in-memory | **no** |
| Build pipeline (`filters:update`, ~190k rules) | CI, once per release | n/a — never on a user machine |
| **Daily live-update pull** | each machine's SW, ~once/day: `manifest.json` + up to 3 payloads from jsDelivr, ~9 KB, SHA-256-checked | **yes — the only shared touchpoint** |

The per-machine cost is **fixed** — a 10,000th user's browser does exactly what the first user's
does. Nothing in the matching, cosmetic, or guard paths has a shared bottleneck, a lock, a queue,
or a round-trip that contends across installs.

The single shared dependency is the once-a-day jsDelivr fetch, already analysed in
[`adblocker-update-feature-and-scale-mechanics-vs-moat-2026-09.md`](adblocker-update-feature-and-scale-mechanics-vs-moat-2026-09.md)
§5: fine to ~10k (~0.1–0.3 GB/day), grey by ~100k, needs `LIVE_BASE_URL` pointed at GitHub Pages
or an object bucket by ~1M. That is a *hosting* limit, not an *algorithm* limit — the client code
scales without change.

---

## Closing

- **Network matching is already at the ceiling** — it's the browser's C++ engine over an
  almost-ideal ruleset. Leave it.
- **All the runtime headroom is per-page content-script work**, and ~90% of that is one thing:
  17,148 generic selectors shipped in a 529 KB file to every page, parsed on the page thread, and
  kept live in the style engine until `load`.
- **A (DOM-surveyor gating) + B (user-origin `insertCSS` from the SW)** together remove that fetch
  and that recalc. They are the two techniques uBO/uBOL/AdGuard/adblock-rust all use and Moat
  doesn't. D + E are small always-on-cost trims worth doing alongside.
- **Concurrency across machines is a non-issue** — the design is embarrassingly parallel; the only
  shared resource is a daily static-file fetch with a one-line host knob.

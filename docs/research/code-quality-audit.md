# Code quality audit: dead code, time/space complexity, overall health

A systematic pass over the whole codebase (not scoped to any recent feature), specifically
looking for dead code and analyzing the real complexity of the hot paths -- content scripts that
run on every page load, and the build-time scripts that process ~190k+ rules. Verdict up front:
**no dead code found, and every hot path checked is already well-engineered** -- this reads more
as a health-check confirmation than a bug-finding pass. Details and method below so the "clean"
verdict is verifiable, not just asserted.

## Dead code: none found

Two independent automated checks, both clean, plus manual greps:

1. **Unused-export scan.** Every `export`ed function/const/class/interface/type/enum across all
   59 non-test `.ts` files in `src/` (208 total), checked for at least one reference anywhere else
   in `src/` or `scripts/` (including test files). **0 flagged as unused.**
2. **Reachability from build entry points.** Built the real import graph from the 13 entry points
   `scripts/build.mjs` actually bundles (background, each of the 9 content scripts, popup,
   options, logger) and walked every relative import transitively. **All 59 files are reachable
   -- 0 orphaned files.**
3. **Manual greps**: no `TODO`/`FIXME`/`XXX`/`HACK` markers anywhere in `src/` or `scripts/`; no
   `console.log`/`console.debug` leftovers in shipped `src/` code; no `if (false)`/`if (true)`/
   `debugger` statements; no commented-out code blocks (the few `// import`-containing comment
   lines are prose explaining a design choice, not disabled code).

Why this came back clean, concretely: `tsconfig.json` already has `noUnusedLocals` and
`noUnusedParameters` on, which `npm run typecheck` enforces on every commit -- that already rules
out dead *local* code (unused variables/params inside a function) before it can land. What was
actually being checked here is the next level up: dead *exports* and dead *files*, which
TypeScript's own compiler doesn't flag (an unused export is still valid to the compiler, since
it's part of a module's public surface). Between the strict compiler settings and this session's
own pattern of removing code cleanly when reverting features (e.g. v0.11.16's popup-drilldown
revert took the `company-info.json` generation code with it, not just the UI), there was
genuinely nothing left to find.

## Time/space complexity of the real hot paths

Content scripts run on every page load and are the actual performance-sensitive surface --
background/build-time code runs far less often (once per settings change, once a day, or once at
build time) so gets a lighter pass below.

### `src/content/cosmeticSelectors.ts` -- runs once per page load

- `shardIndicesForHostname`/`genericSelectorsForHostname`/`domainSelectorsForHostname`: all
  O(chain-depth × selectors-per-domain) or a single O(G) filter pass over the generic set
  (G ≈ 17,000 selectors currently). A plain linear scan over a flat array with `Set` lookups for
  exceptions -- no quadratic behavior, no repeated re-scans.
- `selectorsStillMatching` (the document_idle "prune what matched nothing" pass): O(G) calls to
  `doc.querySelector`, each of which is not O(1) -- selector matching against a large/complex DOM
  can cost real time per call. This is the one place in the content-script path whose real-world
  cost scales with page complexity, not just G. **Already identified and explicitly documented in
  the code itself** (`cosmeticFilter.ts`'s own comment names the jank risk and the
  `requestIdleCallback`/batching mitigation if it's ever reported as real jank) -- not a new
  finding, confirmed correct via the Big-O reasoning here, and confirmed to be running once per
  page load (via a one-time `window.addEventListener("load", ..., { once: true })`), not on every
  DOM mutation.

### `src/content/fingerprintNoise.ts` -- runs per canvas/audio read, opt-in feature

`noisifyRGBA`/`noisifyFloatSamples`: O(pixels)/O(samples), tight allocation-free loops (no
per-element closures or array allocations inside the hot loop), `mulberry32`'s PRNG step is O(1)
integer bitwise math. About as efficient as a per-pixel canvas noise pass can be in JS -- a 4K
canvas (~8M pixels) is a few tens of milliseconds of pure integer math, no GC pressure.

### `src/background/ruleLogger.ts` -- dev-mode-only diagnostic, per-match

`RingBuffer<T>`: genuine fixed-capacity ring buffer, O(1) push (write a slot, advance an index
mod capacity) instead of the classic `array.shift()` anti-pattern (O(n) once full, since every
remaining element has to shift down). Read (`toArray`) is O(count) but only called when the
diagnostic logger page is actually open -- the code's own comment explicitly names this
write-hot/read-rare tradeoff as deliberate.

### Per-tab bookkeeping (`badge.ts`, `matchStats.ts`, `ruleLogger.ts`) -- space, not time

All three keep a `Map<tabId, ...>`, and all three wire into the same `forgetTab` cleanup, called
from `background/index.ts`'s `browser.tabs.onRemoved` listener. Checked concretely: `clearTab` in
`badge.ts` calls a shared `clearTabFromMaps` helper that does a real `Map.delete`, not a
soft-reset -- so this is bounded space (one entry per currently-open tab), not an unbounded leak
that grows across a long browsing session.

### Build-time scripts (`scripts/lib/*.mjs`) -- run once per `filters:update`, over ~190k+ rules

- `chunkBySize.mjs`: O(n) -- explicitly avoids the tempting O(n²) trap of re-`JSON.stringify`-ing
  the whole running chunk on every push (its own comment calls this out); stringifies each rule
  once and tracks a running byte estimate instead.
- `pruneRedundantRules.mjs` (this session's own addition, v0.11.26): O(n × chain-depth) ≈ O(n) for
  ~190k rules -- domain-ancestor lookups go through a `Map<key, Set<domain>>`, so each check is an
  O(1)-average `Set.has` per ancestor level (chain-depth ~3-5), not a nested O(n²) scan. Confirmed
  in practice: the real `filters:update` run processing ~271k total rules completes in a few
  seconds end to end (fetch, prune, chunk, write, validate), not something that would show up as a
  build-time complaint at this scale.
- `validate-rules.mjs`: uniqueness checks (rule ids, cosmetic-selector domains, etc.) consistently
  use `Set`, not nested loops.

## Overall: how well does it work

- **390 tests passing**, `strict: true` + `noUncheckedIndexedAccess` + `noUnusedLocals` +
  `noUnusedParameters` in `tsconfig.json` -- a stricter baseline than a lot of production
  codebases run, and it's actually enforced (every commit this session ran `typecheck` and
  `test` before landing, not just at the end).
- The real bugs found and fixed this session (the inverted drop-priority direction in
  v0.11.20→v0.11.21, the misleading "on" toggle for a budget-dropped filter list in v0.11.22, the
  settings-import content-validation gap in v0.11.24) were all caught by a combination of live
  testing and a security-review pass, not by this static audit -- consistent with this audit
  coming back clean: the kinds of bugs this codebase actually had were behavioral/logic bugs
  (a wrong array-slice direction, a missing validation check), not dead code or complexity
  blowups, and those get caught by tests and review, not a dead-code/complexity sweep. Worth
  stating plainly rather than implying this audit "found" what earlier work already fixed.
- One known, already-documented architectural nuance, not a bug: `src/shared/domainChain.ts`
  (and its build-time twin `scripts/lib/ruleCompany.mjs`) use a naive "walk up by one label at a
  time, stop one short of the bare TLD" domain chain, not a real Public Suffix List -- meaning a
  hostname like `sub.example.co.uk` chains through `co.uk` as if it were a registrable domain.
  This session's own security-review pass looked at this exact question (in the context of
  imported cosmetic-rule selectors) and rated the associated risk below the reporting bar, given
  it requires a user to import an untrusted settings file and can't lead to script execution --
  named here for completeness, not as a new action item.

## Method

Two throwaway scripts (not committed -- one-off analysis, same convention as
`scripts/analysis/*.mjs`): an unused-export scanner (parse every export, regex-search the rest of
the codebase for each name) and a reachability walker (parse every relative import from
`scripts/build.mjs`'s 13 real entry points, transitively). Complexity analysis is direct code
reading against each function's actual loop/call structure, cross-checked against this session's
own real `filters:update` run (271,262 rules, a few seconds end to end) rather than asymptotic
reasoning alone.

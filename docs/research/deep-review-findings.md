# Deeper re-review: real profiling + adversarial input hunting

Follow-up to `docs/research/code-quality-audit.md`, which came back clean (no dead code, no
complexity blowups) using static analysis and Big-O reasoning. This pass used two techniques that
audit deliberately didn't: **empirical timing in a real browser** (not jsdom, which turned out to
be a badly misleading proxy -- see below) and **adversarial input construction** against
validation logic, rather than reading code for obviously-wrong loop shapes.

Two real, fixed issues came out of it.

## Finding 1 (fixed, v0.11.27): the cosmetic-filter trim pass was a real multi-second freeze, not a hypothetical one

`cosmeticFilter.ts`'s `trimUnmatchedGenericRules` already carried its own comment naming a risk:
running `document.querySelector` once per generic selector (~17,000 of them) in one synchronous
pass "risks a jank spike," with a note to fix it "if that's ever reported as real jank." The
previous code-quality audit repeated that framing -- a plausible-but-unconfirmed risk.

**Measured it directly instead of reasoning about it further.** First attempt used jsdom (already
a project dependency, convenient) and got a wildly alarming number: **196 seconds** for 17,000
selectors against a 5,000-element synthetic DOM. That number is not trustworthy on its own --
jsdom's CSS engine (`nwsapi`, pure JS) is nowhere near as fast as a real browser's native selector
matching, and treating it as representative would have been a bad call. Re-ran the identical
benchmark in real Chrome via browser automation instead:

| DOM size | Real Chrome, 17,000 selectors |
|---|---|
| ~13 elements (near-empty page) | 49ms |
| 800 elements (modest page) | 559ms |
| 5,000 elements (a feed/long article) | **4,075ms** |

Four seconds of synchronous main-thread blocking, once, right at page-load-complete, on a page
that isn't even unusually large by modern web standards (a long Instagram/Twitter-style feed
easily exceeds 5,000 DOM nodes). This is not a hypothetical risk the previous comment left open --
it's very likely something Moat has already been doing on complex real pages, just never reported
as "the page froze for a few seconds after it finished loading" because that symptom doesn't
obviously point back to an ad blocker's cleanup pass.

**Fix**: `trimUnmatchedGenericRules` now runs in fixed-size batches (200 selectors each) scheduled
across `requestIdleCallback` slices instead of one synchronous pass, falling back to a plain
macrotask where `requestIdleCallback` isn't available. Verified in real Chrome after the fix:
worst single batch measured at **52ms** (avg ~25ms) against the same 5,000-element DOM -- no
single frame is anywhere near a user-perceptible block. Total wall-clock to finish the *entire*
trim (all 85 batches) stretched to ~29 seconds in that same run, spread across idle time -- that's
expected and correct, not a regression: the page stays fully interactive throughout, and the trim
is a style-engine bookkeeping optimization (fewer live selectors for future recalcs), not
something ad-hiding correctness depends on. Ads are hidden by the full, untrimmed selector set
the entire time either way.

## Finding 2 (fixed, v0.11.28): internationalized custom-rule domains were silently rejected

`customRules.ts`'s domain validation (`HOSTNAME_PATTERN`) is ASCII-only by construction (needed --
the pattern gets interpolated straight into a DNR `urlFilter`). Adversarial check: what happens if
a user types an internationalized domain (e.g. `münchen.de`) into Settings' Custom Rules tab?

**It silently failed.** The non-ASCII character fails the regex outright, and the only feedback is
a `console.warn` in the *background service worker's* console -- invisible to essentially every
real user, who would see their custom block/allow rule for a real, valid domain simply not exist,
with no visible error anywhere.

**Fix**: domains are now run through the `URL` API's own host parser first (`new URL("http://" +
input)`), which performs the IDNA-to-punycode conversion a real browser applies to that same
domain when a request actually happens -- `münchen.de` normalizes to `xn--mnchen-3ya.de`, matching
what the request's real hostname will be. Guarded so this can't *accept* more than the old check
did: anything that parses with a path, port, or credentials attached (`example.com:8080`,
`example.com/path`, `user@example.com`) is still rejected exactly as before, not silently
truncated to just its host portion.

## Checked, found sound (no change needed)

- **ReDoS**: grepped for nested/ambiguous quantifiers across the whole `src/` tree. The only real
  candidates (`HOSTNAME_PATTERN`'s `{0,61}` bound, `generateSelector.ts`'s heuristic regexes) use
  bounded quantifiers with no nested unbounded groups -- not vulnerable to catastrophic
  backtracking.
- **`isUrlFilterCaseSensitive` case-sensitivity**: considered whether an uppercase custom domain
  (`EXAMPLE.COM`) could silently create a rule that never matches, since DNR's `urlFilter`
  matching *could* be case-sensitive. Checked Chrome's own docs directly: the field defaults to
  `false` (case-insensitive), and nothing in Moat's codebase ever sets it to `true`. Not a bug.
- **`feedAdScanner.ts`'s MutationObserver**: already debounces (200ms) and scans only the specific
  added subtrees via a scoped `TreeWalker`, not the whole document on every mutation. No
  rescan-everything anti-pattern.
- **`generateSelector.ts`**: ancestor walk is hard-capped at `MAX_ANCESTOR_DEPTH = 3`, runs once
  per user click (element picker), not a hot path.
- **`isPlausibleTrigger.ts`**: calls `getBoundingClientRect`/`getComputedStyle` once per
  click/`window.open` event, not in a loop -- a single forced-reflow-adjacent read per real user
  interaction is a reasonable cost, not layout thrashing.
- **Fresh-install double-init race** (from the lightweight-architecture audit): re-confirmed
  benign -- both `applyFilterGroupState` calls compute the identical target state, so concurrent
  execution is idempotent regardless of which finishes first.

## Method

Real-browser timing via `claude-in-chrome` automation (not the actual built extension -- a plain
tab with a synthetic DOM and the same algorithm, since loading an unpacked dev build isn't
automatable here) rather than jsdom or Big-O reasoning alone. Adversarial cases constructed by
hand against each validation function's actual regex/parsing logic, not a fuzzer.

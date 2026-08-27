# Lightweight architecture: what's next, and a working audit

Follow-up to the three-part rule-budget work (v0.11.23's "Lite" preset, the consolidation
spike, the dead-rule-pruning spike). Two things happened here: (1) re-verified the current
Chrome platform limits directly against Chrome's own docs (things move; the last research pass
was accurate as of when it ran, but it's worth re-checking rather than assuming), which surfaced
one platform fact that changes a recommendation below, and (2) a working audit of the actual
runtime code (`filterGroups.ts`/`settings.ts`/`index.ts`) for correctness and streamlining
opportunities, independent of the three spikes. Security findings are in their own section.

## 1. Platform facts, re-verified (2026-08-26, against developer.chrome.com)

| Limit | Value | Notes |
|---|---|---|
| `GUARANTEED_MINIMUM_STATIC_RULES` | 30,000 | Unchanged from prior research. Per-extension floor. |
| Static rulesets | up to 100 declared, 50 enabled at once | Raised from 50/10 pre-Chrome 120. Moat has 12 (well under). |
| Dynamic "safe" rules | 30,000 | Used by custom rules, live-redirect rules, quick-fixes. |
| Dynamic "unsafe" rules | 5,000 | |
| Session-scoped rules | 5,000 | Unused by Moat currently. |
| Regex rules (all types combined) | 1,000 | Worth a quick check -- see 2.4 below. |

**New, and relevant: "Starting with Chrome 128, if a user disables an extension through
chrome://extensions, the extension's static rules will no longer count towards the global
static rule limit."** ([source](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest))
Chrome 128 shipped mid-2024, so every Chrome in real-world use today has this. This directly
validates Moat's own budget-warning copy ("try disabling other such extensions") -- disabling
(not just uninstalling) another rule-heavy extension genuinely frees shared budget on any current
Chrome. Section 2.2 below is the gap this surfaces: Moat doesn't currently notice when that
happens.

## 2. Runtime audit: how `filterGroups.ts` actually behaves today

Read `applyFilterGroupState` and its callers end to end (not the two analysis scripts -- the
actual shipped code) specifically looking for behavior a user could hit that isn't described
anywhere.

### 2.1 It already recomputes from scratch every time -- more often than it looks

`applyFilterGroupState` takes no memory of previous drops; every call rebuilds `wantOn`/`wantOff`
fresh from current settings and retries from `drop = 0`. That's clearly intentional (the module
comment says as much) and it means the retry loop **would** naturally pick up newly-freed budget
on its own next run.

The catch: `background/index.ts` calls `initializeSettings()` unconditionally at module top
level, and MV3 service workers don't persist between wake-ups -- the whole script (including that
top-level call) re-runs from scratch on every cold start. With `webNavigation.onCommitted`/
`onCompleted` listeners registered, ordinary page navigation is enough to wake the worker after
its ~30s idle timeout. In an active browsing session, that means `applyFilterGroupState` (fetch +
parse the manifest, build the enable/disable lists, call `updateEnabledRulesets`) plausibly runs
far more often than "whenever settings actually change" -- once per navigation-triggered wake,
even when nothing about the desired state changed since the last call.

**Confidence note:** I can't measure how expensive a same-state `updateEnabledRulesets` call
actually is inside Chrome without live instrumentation, so I'm not calling this a confirmed
performance bug -- it's a real, verifiable *pattern* (rerun-on-every-wake), not a measured cost.

**Streamlining recommendation:** cache a small fingerprint of the last-applied state (e.g. a hash
of `settings.filterGroups` + `enabled` + the manifest's own version/hash) in
`browser.storage.session` -- already the pattern `getOrCreateSessionFingerprintSeed` uses for
exactly this "survives SW restarts within a browser session, not across browser restarts" need --
and skip straight past the `updateEnabledRulesets` call when the fingerprint hasn't changed. Low
risk, self-contained to `filterGroups.ts`, directly reduces the same needless-reapply pattern this
audit found.

### 2.2 Budget that frees up doesn't get reclaimed on its own

Following directly from 2.1's mechanism and the Chrome 128 fact in section 1: if a user follows
Moat's own advice and disables a competing extension, that budget genuinely frees up -- but
nothing in Moat *notices*. The dropped groups stay dropped until something re-triggers
`applyEffectiveSettings()` (a settings change, a managed-policy change, or -- per 2.1 -- the next
service-worker cold start that happens to occur). In practice a SW restart eventually happens on
its own, so this likely self-heals within some unpredictable amount of browsing, but there's no
deliberate mechanism, and no user-visible way to force it besides toggling something in Settings.

**Adding `chrome.management` to actively watch other extensions is the wrong fix** -- it's a
sensitive, broad permission ("see and control every other extension you have installed") that a
privacy-focused ad blocker asking a user to trust it has real reason to avoid, just to solve a
budget-recheck problem.

**Streamlining recommendation:** extend the existing daily alarm in `liveUpdates.ts`
(`initLiveUpdates`, already using the `alarms` permission Moat already declares) to also retry
`applyFilterGroupState` when `getFilterGroupStatus()` shows a non-empty `droppedGroups` -- a
once-a-day reconciliation check, no new permission, reuses an existing pattern instead of adding
one. Not urgent (self-heals eventually per 2.1), but closes a real gap between what Moat's own UI
tells the user to do and what Moat then automatically benefits from.

### 2.3 Fresh-install double-init is benign, but worth naming

`initializeSettings()` runs twice on a genuine fresh install (once from the unconditional
top-level call, once from the `onInstalled` listener with `reason: "install"`) -- both ultimately
call `reapplySettings()`. Traced through deliberately when this was built: each call is
independently idempotent and correctly ordered internally (seed-from-sync always resolves before
the fresh-install lite-default check within *one* call chain), so the worst case is two
back-to-back `updateEnabledRulesets` calls computing the identical end state, not a correctness
bug. Section 2.1's fingerprint-cache recommendation would also incidentally make the second call
a no-op.

### 2.4 Not personally re-verified this pass: the 1,000-rule regex cap

Chrome's docs list a combined 1,000-rule cap on regex-shaped rules across static + dynamic
together. Moat's bundled rulesets are ~82% plain `||domain^` blocks (per the consolidation
audit), but AdGuard's compiled output does include some `regexFilter` rules for pattern-based
blocking. Whether Moat is anywhere near this ceiling wasn't checked in this pass -- flagging as a
one-line follow-up (`grep -c regexFilter rules/dnr/*.json`) rather than guessing.

## 3. Turning the two spikes into real follow-up work

Ranked by risk/effort, not by originally-written order. **All four items below are now done**
(v0.11.24-v0.11.26 plus one docs-only/ci-only commit each) -- kept as a record of the ordering
actually used, not a still-open TODO list.

1. **Add Dependabot/Renovate for `@adguard/dnr-rulesets`** (from the dead-rule-pruning spike). ✅
   Done: `.github/dependabot.yml`, daily schedule, scoped to just this one package.
2. **Automate Finding 1 from the consolidation spike** (drop already-redundant rules). ✅ Done:
   `scripts/lib/pruneRedundantRules.mjs`, wired into `scripts/update-filters.mjs`, with a
   semantic-equivalence regression test (v0.11.26). 4,726 rules pruned on the day it landed.
3. **Section 2.1/2.2's fingerprint-cache + daily-alarm reclaim.** ✅ Done (v0.11.25):
   `applyFilterGroupState` now caches a fingerprint in `storage.session` and skips a redundant
   `updateEnabledRulesets` call when nothing changed since the last fully-successful apply;
   `liveUpdates.ts`'s existing daily alarm now also forces a real recheck, bypassing that cache,
   to notice budget that changed for reasons outside Moat's own settings.
4. **Finding 2 (risky consolidation) as a *reviewed*, not automatic, feature.** ✅ Done:
   `scripts/analysis/consolidation-candidates-reviewed.mjs` cross-references every candidate
   group against `@ghostery/trackerdb` and writes `docs/research/consolidation-candidates-reviewed.md`
   -- 35 of ~727 candidates confirmed to a single company on the day it was built, the rest
   deliberately left unnamed. Still nothing more than a list for a human to review one domain at
   a time; nothing auto-applies a consolidated rule.

Also fixed alongside these, from section 4's security audit: `validateImportedSettings` now
validates cosmetic-rule selector content (not just shape) and length-caps every imported
array/record field (v0.11.24).

## 4. Security audit

Ran a full security-review pass (input validation, injection, auth, crypto/secrets, data
exposure) against every commit on this branch not yet on `origin/master` -- not just today's
three parts, the whole unpushed history (i18n infrastructure, settings export/import/sync, the
HIBP leaked-password check, per-session fingerprint rotation, the quick-fixes channel, and the
filter-preset/budget-degradation work). Two passes: identify candidates, then independently
filter each for false positives against a high bar (>=8/10 confidence, exploitability-focused,
DOS/hardening/self-XSS-style issues excluded by design).

**Result: no finding cleared the reporting bar.** Full disposition of every candidate that came up:

| Candidate | Verdict | Why |
|---|---|---|
| Quick-fix channel's `allow` action could override some bundled block rules via a compromised remote feed | Real design inconsistency, below reporting threshold | `quickFixRules.ts` runs `allow` actions at DNR priority 1, while `customRules.ts` uses priority 2 for its own override pattern -- inconsistent, but checked against the actual shipped `rules/dnr/*.json` priorities: the malware/phishing/scam rulesets run at priority 55 and are unaffected. Only ad/annoyance rules and one badware list are in reach. Worth tidying for consistency, not a real exposure. |
| Quick-fix `urlFilter` has no format/anchoring restriction | False positive | Reduces to over-blocking/breakage risk (excluded -- DOS/hardening), not independently exploitable. |
| `syncEnabled` mirrors settings (including custom domain lists) to `storage.sync` | False positive | Documented, opt-in, off by default, uses the platform's own sync mechanism; `fingerprintSeed` already correctly excluded. Working as designed. |
| `validateImportedSettings` accepts arbitrary strings into `customCosmeticRules`/`customGrayscaleRules` without validating selector content | False positive (self-XSS-equivalent precondition) | Traced the sink myself: `cosmeticFilter.ts` writes these via `styleEl.textContent`, never `innerHTML` -- setting `textContent` never re-enters the HTML parser, so a selector containing `</style><script>` stays inert literal text, not markup. What's left is CSS injection, not script execution, and it only reaches a victim if they import an untrusted settings-export file themselves. Real gap (import validates *shape*, not selector *content*), but low real-world exploitability -- noted as a hardening opportunity below, not a vulnerability. |

**Worth hardening anyway, even below the vulnerability bar:** `validateImportedSettings` (and the
matching test file) could reasonably reject `customCosmeticRules`/`customGrayscaleRules` selector
strings that don't look like plausible CSS (length cap, character allowlist) and cap array
lengths on every imported field -- cheap, and removes the one path in this codebase where an
external file's string content reaches a `<style>` element with zero content-level validation,
even though the exploitability today is low.

Two more observations from this pass worth surfacing as trade-offs rather than vulnerabilities:

- **The "Lite" fresh-install default deliberately ships less phishing protection than before.**
  Lite = Essential minus `phishing-urls` (Moat's single largest security list, ~64,600 rules).
  This was an explicit, approved trade-off (budget headroom over maximal default coverage), not
  an oversight -- but it is a genuine security-relevant behavior change for anyone who installs
  Moat and never touches Settings again: a phishing page one of Moat's other security lists (
  `malicious-urls`/`scam`/`badware`) doesn't happen to cover would previously have been more
  likely caught, and now depends on the shared budget having room for a manual switch to
  Essential/Standard/Strict. Worth the user's own eyes now that it's live, not just a design-time
  decision.
- **The two new analysis scripts fetch live data from the network** (`publicsuffix.org`, the npm
  registry) **but are dev-only tooling, never invoked by the shipped extension or CI.** No
  supply-chain exposure to end users either way -- flagging only so it's clear why this wasn't
  treated as an extension-security concern in the review below.

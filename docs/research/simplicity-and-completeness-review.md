# What's missing, what would make Moat more powerful, and what would make it simpler

Three questions, answered together because they trade off against each other: adding power
without adding complexity requires deliberately not exposing it. This doc separates
**gaps** (things a shipping extension is generally expected to have, verified against Moat's
actual code, not assumed), **power** (net-new capabilities), and **simplicity** (making the
thing Moat already does easier for a non-technical person to pick up and trust) --- and ends
with one merged, prioritized list.

This doc does not re-research power features already covered in
[`feature-expansion-survey.md`](feature-expansion-survey.md) (leaked-password check,
Decentraleyes-style local CDN mirroring, ClearURLs gap audit -- the fourth candidate that
doc originally listed, a per-tab tracker/company list, turned out to already be shipped;
see that doc's corrected §2) or
[`ad-blocker-architecture-and-roadmap.md`](ad-blocker-architecture-and-roadmap.md) (all 9
candidates there already shipped, v0.7.5--0.9.0). Both are summarized under "Power," not
repeated.

---

## Part 1: Gaps

Each of these was checked directly against the current codebase, not assumed from general
extension-development knowledge.

### 1a. No accessible labels on any toggle switch -- a real, present bug, not a nice-to-have

Every settings toggle in both `options.html` and `popup.html` follows this shape:

```html
<div class="card-title">Protection enabled</div>
<p class="hint muted">Toggle to turn off all blocking globally.</p>
<label class="switch">
  <input type="checkbox" id="master-toggle" />
  <span class="track"><span class="thumb"></span></span>
</label>
```

The `<label>` wraps only the visual switch (`track`/`thumb`), not the text describing what
it does -- that text lives in a sibling `<div>`, entirely disconnected from the checkbox in
the accessibility tree. A screen reader lands on this control and announces "checkbox,
not checked" with no name at all. This is every toggle in the product (13 across
`options.html` + `popup.html`), not an edge case. `<button>` elements like the preset row
(`data-preset="essential"`) have visible text so they're fine; the switches are the gap.

**Fix is small and mechanical**: add `aria-labelledby` pointing at the existing
`card-title` element's `id` (or wrap the whole row in the `<label>`) for each of the 13
switches. No visual change, no new dependency.

### 1b. English-only -- no `_locales`, no `chrome.i18n`/`browser.i18n` anywhere

`scripts/manifest.ts` has no `default_locale` key, there is no `src/_locales/` directory,
and nothing in the codebase calls `chrome.i18n.getMessage`. Every string is hardcoded
English, inline, across `options.html`, `popup.html`, and the `.ts` files that write to
`textContent`. This is the single largest barrier to "everyone can use it" if "everyone"
includes non-English speakers -- which, for a general ad blocker (not a developer tool),
is most of the addressable audience.

This is real work, not a small fix: every user-facing string needs to move into
`_locales/en/messages.json` (and be looked up via `i18n.getMessage()`) before any
translation is possible at all, even before a second language exists. Scoping it as
"switch to the i18n messages system, ship English only" is the honest first slice; adding
actual translations is a separate, ongoing, and much larger commitment (translation
quality, upkeep as strings change) that shouldn't be conflated with the infrastructure
work.

### 1c. No onboarding -- new users get a silent icon and nothing else

There is no `browser.runtime.onInstalled` listener anywhere in `src/background/`. On
install, Moat starts working immediately (arguably a feature -- "no nag screens" is in the
README's own tagline) but a first-time user has zero indication of what just happened, what
the badge count means, or that Settings exists and is worth a look. Compare to the explicit
non-goals already stated in the README ("No nag screens, no 'rate us' prompts, no onboarding
tabs") -- this was a deliberate philosophical choice, not an oversight, and needs to be
reconciled explicitly rather than silently reversed (see Verdict below).

### 1d. Settings never leave the device -- `storage.local` only, no `storage.sync`

`src/background/settings.ts` reads/writes exclusively via `browser.storage.local`. A user
signed into Chrome or Firefox sync on two machines has to reconfigure Moat twice, with no
path to unify them. This is a real "everyone can use it" gap for anyone with more than one
computer, which is most people.

### 1e. No settings export/import

There's no way to save a configuration to a file and load it elsewhere -- not on a second
device (see 1d), not as a backup before a browser reinstall, not to share a known-good
config with someone else. `Settings` (in `src/types.ts`) is already a single flat
JSON-serializable object, which makes this cheap: a "Download settings" button that
`JSON.stringify`s it and an "Upload settings" file input that validates and calls
`setSettings()` covers it without new architecture.

### 1f. No keyboard shortcut

`scripts/manifest.ts` has no `commands` key. There's no way to toggle protection or open the
popup without a mouse. Low-cost, high-value for power users and for anyone relying on
keyboard navigation for accessibility reasons.

### 1g. No in-product "what's new"

`CHANGELOG.md` is thorough (every release documented) but git-only -- nobody who isn't
reading the repository ever sees it. There's no `onInstalled` `reason: "update"` handler
that shows what changed. Related to 1c (same missing listener could serve both).

### 1h. Manifest metadata gaps

No `short_name` (used when the full `name` doesn't fit, e.g. on the toolbar in some
contexts), no `homepage_url`, no `default_locale` (see 1b). Minor, and cheap to close
alongside the CWS listing work already in progress.

---

## Part 2: Power (net-new capability)

Already thoroughly researched and shortlisted in `feature-expansion-survey.md`; summarized
here only so this doc is a complete answer to "what else can we add":

1. Opt-in leaked-password check on password fields via HIBP's free k-anonymity API.
2. ~~Read-only per-tab tracker/company list in the popup~~ — **correction (2026-08-26):
   already shipped** (`matchStats.ts` + `popup.ts`'s `renderCompanyBreakdown()`). Struck
   here; see `feature-expansion-survey.md` §2 for the full correction.
3. Decentraleyes-style local mirroring of common CDN-hosted JS libraries.
4. Audit the bundled URL-tracking filter list against ClearURLs' catalog for coverage gaps.

None require new architecture Moat doesn't already have (DNR redirects, the TrackerDB
correlation pipeline, and the existing warn-don't-decide UI posture all get reused). See
that doc for sourcing and cost estimates per item.

One additional power angle *not* in that survey, worth naming: **a real settings
export/import (1e above) doubles as the foundation for "share a filter/config preset with
someone else"** -- e.g., a technically-inclined user hand-tunes a strict configuration and
hands the exported JSON to a less technical friend. Cheap to build once, serves both a
simplicity need (backup/sync workaround) and a power need (config sharing) at once.

---

## Part 3: Simplicity -- making what already exists easier to trust and use

Moat already has the single most important simplicity mechanism a blocker like this can
have: the Off/Essential/Standard/Strict preset row (`src/options/filterPresets.ts`), which
means a non-technical user never has to look at 18 individual filter-list toggles. That's
worth stating plainly so the next few suggestions read as *filling gaps around* an
already-good foundation, not a rebuild.

- **Reconcile the "no onboarding" philosophy with the "no onboarding *tabs*" README claim
  (1c).** These aren't the same thing. A single, small, dismissible first-run *card inside
  the popup itself* ("Moat is now blocking ads and trackers on every site. Settings →" with
  a link) costs one `onInstalled` check and a `storage.local` flag, respects the "no nag
  screens" philosophy (it's not a modal, not a new tab, not recurring), and closes the
  actual problem (a new user has no idea what the icon means) without contradicting the
  stated design principle. This needs a decision, not just code -- flagged for you, not
  something to build unilaterally given the README explicitly commits to the opposite.
- **Fix the 13 unlabeled toggles (1a).** This isn't just an accessibility nicety --
  unlabeled controls are also harder for *anyone* skimming quickly to be sure they're
  toggling the thing they think they are, since screen magnification / voice control users
  hit the same gap sighted mouse users don't notice.
- **Settings export/import (1e) as a "reset with confidence" safety net.** A meaningful
  chunk of "too complex for non-technical users" isn't the number of settings -- it's fear
  of breaking something with no way back. A visible "export before you experiment" affordance
  lowers the stakes of touching Advanced Protection or Individual Filter Lists at all.
- **i18n infrastructure (1b) is the highest-leverage simplicity investment on this list**,
  precisely because it's not about simplifying anything for the current (English-reading)
  user base -- it's about who's excluded from "everyone" entirely today.

---

## Merged priority list

Roughly small-to-large, each independently shippable:

1. Add `aria-labelledby` to the 13 toggle switches (1a) -- mechanical, no design decision
   needed, closes a real bug.
2. Add a `commands` keyboard shortcut (1f).
3. Add `short_name`/`homepage_url`/`default_locale` to the manifest (1h) -- bundle with the
   i18n infrastructure work (1b) since `default_locale` is meaningless without `_locales/`.
4. Settings export/import (1e) -- small, serves both the sync gap (1d) and a power use case.
5. `storage.sync` for settings, with a fallback/merge strategy for the two-machines-drifted
   case (1d) -- needs a little more design thought than #4 (what happens on conflict) but
   builds directly on it.
6. In-product "what's new" on update (1g), reusing the `onInstalled` listener from whichever
   onboarding decision comes out of the item below.
7. **Decision needed, not just code**: a minimal first-run popup card (part of 1c) --
   this is the one item on this list that revisits an explicit, stated design principle in
   the README, so it shouldn't be built without you weighing in first.
8. i18n infrastructure -- move strings to `_locales/en/messages.json` (1b). Large, mechanical,
   no translations yet; a prerequisite for ever supporting a second language, not a feature
   in itself.
9. The four power candidates from `feature-expansion-survey.md` (Part 2 above) -- unchanged
   priority from that doc, listed last here only because this doc's focus is gaps/simplicity.

# Fixing Moat's drawbacks — researched fixes, feasibility, and sequence (2026-09)

Companion to the drawbacks discussion. For each drawback that has a real fix, this pins down the
*mechanism*, checks it against current browser support and Moat's code, and flags the gotchas.
Drawbacks that can't be fixed in this model are named as such with the honest mitigation.

**Builds on, doesn't repeat:**

- Per-page performance changes A–F —
  [`blocking-algorithm-cost-and-parallelism-2026-09.md`](blocking-algorithm-cost-and-parallelism-2026-09.md).
  This doc adds the *mechanism detail* for A and B.
- Live-update-channel hardening B1–B8 —
  [`adblocker-update-feature-and-scale-mechanics-vs-moat-2026-09.md`](adblocker-update-feature-and-scale-mechanics-vs-moat-2026-09.md).
  This doc adds signing and the GitHub Pages host.
- The subdomain-pause fix is already fully scoped in
  [`data-usage-optimization-ui-user-demand-2026-09.md`](data-usage-optimization-ui-user-demand-2026-09.md)
  §5 ("if you build one thing next").

Confidence: **[web]** live search this pass · **[measured]** against the current build · **[general]**.

---

## Part 1 — Live-update channel + operations

### 1.1 Sign `live/manifest.json` (closes "trust = a GitHub account")

**Mechanism.** One Ed25519 keypair. Private key lives in a GitHub Actions secret (or fully offline,
signing done locally before push). Public key (32 bytes) is a `const` bundled in the extension.
`scripts/update-live-manifest.mjs` writes the manifest, then signs its exact bytes and writes
`live/manifest.json.sig` (base64). `liveUpdates.ts` fetches both, verifies with WebCrypto
(`crypto.subtle.importKey("raw", pubkey, {name:"Ed25519"}, …)` →
`crypto.subtle.verify("Ed25519", key, sig, manifestBytes)`) **before** trusting any hash in it.
A bad signature → keep the bundled baseline, exactly like a hash mismatch today.

**Browser support [web]:** WebCrypto Ed25519 shipped Chrome **137** (May 2025), Firefox **129/130**
(Aug 2024), Safari 17. Moat's `minimum_chrome_version` is **111** — so either bump it to 137 (137 is
~18 months old by end-2026; acceptable) **or** bundle a verify-only Ed25519 (~2–4 KB, e.g. a
trimmed `@noble/ed25519`; verify is the only op needed on the client). Bumping the manifest floor
is cleaner and drops a dependency.

**What it buys.** The remote channel stops being "whoever holds the GitHub account can push
block/allow rules." Now it's "whoever holds the signing key." The key never touches the CDN or the
repo working tree; a leaked key is revoked by shipping an extension update with a new public key
(no PKI, no rotation service — Mozilla's Remote Settings uses a full x5u cert chain **[web]**, which
is overkill for one maintainer).

**Effort:** M. New: sign step in the script, `.sig` file, pubkey const, verify in `liveUpdates.ts`,
a manifest-floor bump or the bundled verifier. ~1 focused session.

### 1.2 Move `LIVE_BASE_URL` to GitHub Pages (kills the jsDelivr 7-day cache)

**[web]** GitHub Pages sends `Cache-Control: max-age=600` (10 min), served via Cloudflare, and a
push propagates in minutes — **no purge step, no AUP problem** (Pages exists to serve files).
Contrast jsDelivr's `@master` path: up to 7-day max-age and an unreliable purge.

**Mechanism.** A tiny CI job copies `live/*` (manifest, `.sig`, the three payloads) to a `gh-pages`
branch on every push to `master`; enable Pages on that branch. `LIVE_BASE_URL` becomes
`https://samuelabhinav37.github.io/moat/live`. With 1.1 in place the host is fully untrusted, so
this is a one-constant change plus a 6-line workflow. `scripts/purge-live-cdn.mjs` is then dead
code — delete it.

**Effect on the scale numbers.** Same as before (client code unchanged), but now the worst-case
staleness is 10 min, not 7 days, and there's no per-push manual step. Pages' Cloudflare front is
built for this volume; the ~100k / ~1M thresholds from the scale doc still apply as bandwidth
notes, not correctness limits.

**Effort:** S.

### 1.3 Scheduled `filters:update` PR (fixes "freshness depends on the maintainer remembering")

A weekly `schedule:` GitHub Action: `npm run filters:update` → `peter-evans/create-pull-request`
opens a PR titled `chore: weekly filter refresh` with the diff. The maintainer reviews the rule
delta and merges (or a follow-up auto-merges if the full gate is green and the diff is under a size
threshold). Doesn't touch the release cadence — just removes the "did anyone refresh the lists?"
failure mode.

**Effort:** S.

### 1.4 A real beta path — and percentage rollout once there's scale

**[web]** The Chrome Web Store **v2** API supports `?publishTarget=trustedTesters` (a closed beta
group on the listed item) **and** `deployPercentage` / `setPublishedDeployPercentage` — a partial
rollout you can advance (10% → 50% → 100%) **without re-review**, available once the item has
>10,000 7-day active users.

- **Now (pre-scale):** add a `trustedTesters` submit path to `publish.yml` (a second job, same
  secrets, `publishTarget=trustedTesters`), fed by a `beta` branch. A risky filter/engine change
  lands for testers in hours.
- **Later (>10k users):** every release ships at `deployPercentage: 10`, watched for a day via the
  "Report a problem" inflow, then bumped to 100 — a real staged rollout for a solo maintainer, no
  review latency on the bump.

**Effort:** S now, S later (it's an API parameter).

### 1.5 Arm `publish.yml`

Create `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` / `CWS_PUBLISHER_ID` /
`CWS_EXTENSION_ID` and `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` as repo secrets (~30 min, one-time). The
workflow is written and dormant. Confirm the CWS v2 upload body shape on the first real run (noted
in the workflow comment). This turns "hours of manual upload" into "dispatch a workflow."

**Effort:** S (mostly the maintainer's account setup).

---

## Part 2 — Per-page performance (mechanism detail for A + B)

### 2.1 DOM-surveyor gating — how uBO actually does it

**[web, from uBO `contentscript.js`]:**

- **Token hash.** A DJB2-style 24-bit hash, `type` (class vs id) folded in:
  `hash = (type<<5) + type ^ len; for i step: hash = (hash<<5)+hash ^ s.charCodeAt(i); return hash & 0xFFFFFF`.
  The compiler uses the identical hash so build and runtime agree — the same discipline Moat's
  `bucketForDomain` FNV already follows.
- **Build side.** Every generic selector is filed under the hash of its anchoring class/id token
  (`.ad-box` → hash of `ad-box`). Selectors with no single anchoring token ("generic-high":
  `[data-ad]`, `div > .x`) go into a small wholesale set — a few hundred, not 17k.
- **Runtime.** On `onDOMCreated`, walk the DOM, collect every `class`/`id` token, hash into a
  `Set` (`queriedHashes`). For each *new* hash, pull its generic selectors and inject them. Re-run
  on mutations via a `domWatcher`, **batched** (`bufferSize = 256`, `maxSurveyNodes = 65536`); the
  surveyor **self-disables** once scanning stops finding anything.
- **Injection.** `vAPI.userStylesheet.add(cssText)` — a user-origin sheet.

**For Moat.** `update-cosmetics.mjs` emits `genericByHash: Record<hash24, string[]>` +
`genericHigh: string[]` instead of `generic: string[17148]`. `cosmeticSelectors.ts` gets the hash
function (shared build/runtime like `domainBucket`) + a surveyor. `cosmeticFilter.ts` runs the
surveyor after DOM-ready, injects only matched generics. The existing `excludedForChain` exception
logic still filters the result. `cosmeticSelectors.test.ts` covers the pure parts.

**Payoff [measured]:** `cosmetics-meta.json` (**529 KB** today, the 17k generic array) collapses to
a hash map that's smaller and only partially relevant per page; the style engine evaluates dozens
of generic selectors, not 17,148; the post-`load` trim (`trimUnmatchedGenericRules`) is deleted.

**Effort:** M–L.

### 2.2 `insertCSS` from the SW — the timing reality

**[web]:** `webNavigation.onCommitted` fires in the SW per-frame, **before `document_idle`**, and
is "earlier than waiting for a content-script message" — but `executeScript`/`insertCSS` triggered
from it "occasionally may run *after* a manifest-declared `document_start` content script." So it's
**roughly `document_start`-class timing, not guaranteed-earlier**. For a *hiding* stylesheet a
brief race with first paint is the same exposure the current `<style>` injection already has.
Chrome injects `origin:"author"` CSS at the "user" cascade position anyway (a known bug,
w3c/webextensions#906) — harmless here; use `origin:"USER"` explicitly so it's intentional.
`removeCSS` needs an exact `{css, origin}` match to undo.

**Architecture (mirrors uBOL).** SW, on `onCommitted`: compute the tab domain's **specific**
selectors (pure `domainSelectorsForHostname` — no DOM needed) → `scripting.insertCSS({target:{tabId,
frameIds:[frameId]}, css, origin:"USER"})`. A thin content script runs **only** the 2.1 surveyor
and posts matched generic selectors back for a second `insertCSS`. Net: no page-thread `fetch`, no
`JSON.parse` on the page, no content-script `<style>` build; the browser owns the sheet.

Firefox parity: `browser.tabs.insertCSS(tabId, {code, cssOrigin:"user", frameId})` — same idea,
long supported.

**Effort:** M.

### 2.3 Collapse the blocked element (fixes the empty-ad-box gap)

**[web]:** Brave ships this (brave-core#9144 — "Collapse HTML elements with blocked image/iframe
requests"). Pure MV3 can't get a per-request blocked callback in production
(`onRuleMatchedDebug` is unpacked-only). Two viable routes:

1. **Build-time element-hiding from the network blocklist.** For each blocked domain, emit
   `iframe[src*="domain"], img[src*="domain"] { display:none!important }` cosmetic rules. AdGuard's
   lists already carry many; a script that widens coverage from Moat's own DNR domains is cheap and
   hides the ad *element*, not just leftover wrappers. Ships in the cosmetic path.
2. **Generic collapse heuristic** in the content script: after `load`, find `<iframe>`/`<img>` whose
   `naturalWidth===0` / failed to load *and* whose src host is on the bundled blocklist set (the
   same set fix C wants), collapse the nearest sized ancestor. Throttled, one pass.

Route 1 is the lower-risk default.

**Effort:** M.

---

## Part 3 — Feature reach

### 3.1 Subdomain-aware "Pause on this site" + "allow site & subdomains"

Already scoped in `data-usage-optimization-ui-user-demand-2026-09.md` §5: `isSiteDisabled()` in
`src/background/settings.ts` is exact-hostname-only; the repo already has **three** tested
same-or-subdomain matchers (`redirectDomainMatch`, `cnameUncloakMatch`,
`cosmeticSelectors` parent-domain walk). Wire one in; add a one-click "allow this site and its
subdomains" that stores an eTLD+1 entry. **Highest value ÷ effort on the whole list.**

**Effort:** S.

### 3.2 Firefox for Android

**[web]:** Open extension ecosystem on Firefox Android since Dec 2023, mature by 2026 — any
AMO extension marked Android-compatible installs like on desktop, **same WebExtension APIs, no
rewrite**. Moat already builds a Firefox target. The work:

- `browser_specific_settings.gecko_android` / mark Android-compatible on the AMO listing.
- UI: the popup must work in a narrow viewport with no persistent toolbar space — audit
  `popup.html` for min-width assumptions; the options page is fine.
- Test the content-script + DNR paths on Firefox Android (Gecko's MV3 DNR has had gaps historically
  — verify `declarative_net_request` static rulesets load and match; fall back to the `webRequest`
  blocking path Firefox still allows if needed).
- No Chrome-Android path (no extensions). Safari = a separate Xcode port, out of scope solo.

**Effort:** M. Genuine mobile ad-blocking on the strongest-privacy story in the category.

### 3.3 Exception audit view

Fold the paused-sites list into the existing Settings → Custom Rules tab (which already lists
blocked/allowed sites with per-entry removal) for one combined "what have I overridden" surface.
**Effort:** S.

---

## Part 4 — The coverage ceiling and the MV3 tax (what's *not* fixable here)

| Drawback | Verdict | Honest move |
|---|---|---|
| SSAI / first-party ad masking / native ads / encrypted payloads | **Not fixable** in a quiet MV3 extension. Every real countermeasure needs a capability outside the model — a TLS-intercepting local app (AdGuard's desktop model), a custom native client (SmartTube), or in-browser ML (Percival, unshipped). All break Moat's identity. | One line of honest UI/store copy naming what a client-side blocker can't touch. Don't chase it. |
| Anti-adblock walls (guarantee content renders) | **Not fixable** in that direction. The "defeat the detector" direction is already the shape of the filter lists + the live channel. | Keep the scriptlet/quick-fix/cosmetic-fix channel responsive (now much better post-v0.11.54). |
| YouTube detect-and-block-playback war | **Not winnable** client-side against a first-party server. | Keep the narrow ad-dimmer + two-signal detection. Stop there. |
| Store-review latency for non-selector filter changes | **Partly fixed.** The cosmetic-fixes channel covers the common wave; an armed `publish.yml` + auto-submit shrinks the rest to hours. | The residual ~1–5 day review for engine/rule changes is the MV3 tax; a `trustedTesters`/rollout path (1.4) softens it. |
| `<all_urls>` at install | **Not reducible** for a content blocker. | A one-line rationale at install and in the store description. |
| 330k global DNR budget shared with other blockers | **Platform limit.** Moat's `filterGroups.ts` already reacts to budget pressure. | Make the Lite (~85k) preset a more prominent choice; keep the budget-contention message clear. |

---

## Part 5 — Distribution

The privacy story ("no server, no telemetry, no account, open source, MV3-native") is the category's
strongest and is currently invisible.

- **A landing page** on the same GitHub Pages site that 1.2 stands up — reuse the "How Moat Works"
  layout; lead with the privacy stance; link the source and `PRIVACY.md`.
- **`PRIVACY.md`**: a 4-line summary at the top (what's read, where it goes = nowhere, what's
  stored locally, the one daily static fetch) before the detail.
- **Store description**: first sentence is the privacy position, not the feature list.

**Effort:** S. Highest adoption leverage on the list.

---

## Sequence

1. **1.1 signing + 1.2 GitHub Pages** together — they reinforce (signing makes the host untrusted,
   Pages removes the 7-day cache and the manual purge). Closes the two operational/security
   drawbacks in the live channel.
2. **3.1 subdomain pause** + **3.3 exception audit** + **1.3 scheduled filter PR** + **Part 5
   landing page** — all S, all independent, knock out the top feature and distribution gaps.
3. **1.5 arm publish.yml** + **1.4 trustedTesters path** — makes 1–2 shippable fast and adds a
   beta safety valve.
4. **2.1 DOM surveyor + 2.2 insertCSS split** — the big per-page performance win; do them as one
   piece since 2.2 is the injection half of 2.1.
5. **2.3 collapse-blocked-element** (route 1) alongside 2.1's build changes.
6. **3.2 Firefox for Android** — a standalone M effort; the payoff is a new platform, not a fix to
   an existing one, so it can slot wherever there's appetite.

Everything except 3.2 preserves the zero-server / zero-telemetry identity, and none of it needs a
backend.

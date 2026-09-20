# Release Procedure

## Prepare (manual)

1. Start from a clean default branch and install dependencies with `npm ci`.
2. Update the version in `package.json` and add the release's `CHANGELOG.md` section.
3. Review permission changes and, for the tracked `live/*.json` slice specifically, its provenance
   for the reviewed commit -- see "Filter lists" below for what this does and doesn't cover; the
   bulk of the ruleset regenerates into a gitignored directory this step has no visibility into.
4. Audit dependencies and document unresolved advisories that affect release tooling or runtime behavior.

## Build and package (automated)

5. Push a `vX.Y.Z` tag matching `package.json`'s version. `.github/workflows/release.yml` then, on
   a clean checkout: verifies the tag matches `package.json`, refreshes filters, runs rule
   validation / type checking / unit tests / both browser builds / Firefox extension linting,
   runs `npm run zip`, computes `SHA256SUMS.txt`, and opens a **draft** GitHub Release with
   `chrome.zip`, `firefox.zip`, and `SHA256SUMS.txt` attached and the matching `CHANGELOG.md`
   section as the body. The tag/version guard fails the run if they disagree.

   To reproduce locally: `npm run build && npm run zip && sha256sum chrome.zip firefox.zip`.

## Ship

6. Test the unpacked packages in supported Chrome and Firefox versions. The Firefox package also
   declares `gecko_android` (min 142), so AMO lists it for Android automatically — spot-check the
   popup and options pages on Firefox for Android (`web-ext run -t firefox-android`) when the UI
   changed.
7. Review the draft release's attached zips and checksums, then publish it.
8. Submit to the stores — either by hand, or via the **Publish to stores** workflow
   (`.github/workflows/publish.yml`, `workflow_dispatch`), which rebuilds from the tag,
   re-runs the full gate, and submits `chrome.zip` / `firefox.zip` for review. It is a
   deliberate manual trigger, never automatic on a tag, and each store step **skips cleanly
   if its credentials are absent** — so it stays dormant until you set these repository
   secrets:

   | Secret | Store | How to get it |
   |---|---|---|
   | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Chrome Web Store | A Google Cloud OAuth client (type *Desktop*) with the Chrome Web Store API enabled; the refresh token from a one-time consent (`chrome-webstore-upload-keys` or the manual OAuth flow). Re-use it at least every 6 months or Google expires it. |
   | `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID` | Chrome Web Store | Publisher (developer account) id and the item id, both from the developer dashboard. The workflow uses the **v2** API (`chromewebstore.googleapis.com`); the v1 API is turned off 2026-10-15. |
   | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | AMO | addons.mozilla.org → *Manage API Keys*. |

   The workflow's **`channel`** input: `stable` = the public listing; `beta` = the CWS
   trusted-testers track + an AMO unlisted build, for shaking down a risky filter/engine change
   before it reaches everyone. Once the CWS item has >10k 7-day users you can also advance a
   staged rollout (`deployPercentage`) without re-review — not wired into the workflow yet.

Store signing credentials and browser-store tokens stay outside the repository. A Git tag
identifies exactly the source used for submitted packages.

## Live-update channel (one-time)

- The live files (`live/*.json` + `live/manifest.json.sig`) are published to the **`gh-pages`**
  branch by `.github/workflows/publish-live.yml`. After its first run, enable Pages:
  *Settings → Pages → Deploy from a branch → `gh-pages` / `/` (root)*. Until then the extension's
  live fetch 404s and it keeps its bundled baseline (harmless — the payloads ship empty).
- To turn on **manifest signing**: `node scripts/gen-live-signing-key.mjs` once, put the private
  key PEM in the `LIVE_SIGNING_PRIVATE_KEY` Actions secret, paste the public key into
  `src/shared/liveSigningKey.ts`, and commit a `npm run filters:update` (which now also writes
  `live/manifest.json.sig`).

## Filter lists

`.github/workflows/filter-refresh.yml` runs `npm run filters:update` every Monday and opens a
`chore/filter-refresh` PR. Review the diff and merge — CI runs the full gate on the PR. Nothing
auto-merges.

**What that diff actually covers, and what it doesn't:** `rules/dnr/` and `rules/redirect-resources/`
are gitignored (see `.gitignore`) -- the bulk of the ruleset (currently ~349,000 rules from
`@adguard/dnr-rulesets`, plus Peter Lowe's list and oisd, all three of the latter fetched live at
build time over plain HTTPS, unpinned) is regenerated into a directory `git diff` can never see a
change in, no matter how much its content shifts week to week. The PR's diff is only ever the
small, explicitly tracked `live/*.json` slice (the ~500-domain popup/redirect list and the
emergency quick-fix/cosmetic-fix channels) -- genuinely reviewable, but a small fraction of what
`filters:update` actually regenerates. This also means a release built from a given tag isn't
fully reproducible: running `npm run build` today vs. next week from the identical tag can
legitimately produce different `chrome.zip`/`firefox.zip` bytes, since those three live-fetched
sources aren't pinned by `package-lock.json` the way `@adguard/dnr-rulesets`/`@ghostery/trackerdb`
are.

**Partially closed**: `rules/live-filter-source-provenance.json` (tracked, unlike `rules/dnr/`
itself) now records a SHA-256 + item count for each of the three live-fetched sources on every
`filters:update` run, and the script logs `unchanged`/`CHANGED`/`first run` per source. This makes
the *fact* that one of them changed visible in the weekly PR's diff (a flipped hash), even though
the actual expanded rule content still isn't line-by-line reviewable. It does not, and cannot,
make a rebuild byte-for-byte reproducible across time -- these three sources are daily-updated
upstream lists by design (that's the reason to fetch them live at all, same as
`filter-refresh.yml`'s own weekly cadence), so "the same tag can build different bytes next week"
is an inherent property of using live-updated third-party sources, not a bug this can close. What
remains open: moving these three fetches' actual diff into the reviewable PR flow (not just a
hash) would need committing their expanded output somewhere other than the gitignored `rules/dnr/`
-- not attempted here given the size (tens of thousands of domains per source).

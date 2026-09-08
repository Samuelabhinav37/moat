# Release Procedure

## Prepare (manual)

1. Start from a clean default branch and install dependencies with `npm ci`.
2. Update the version in `package.json` and add the release's `CHANGELOG.md` section.
3. Review permission changes and generated filter provenance for the reviewed commit.
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

6. Test the unpacked packages in supported Chrome and Firefox versions.
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
`chore/filter-refresh` PR with the rule delta. Review the diff and merge — CI runs the full gate
on the PR. Nothing auto-merges.

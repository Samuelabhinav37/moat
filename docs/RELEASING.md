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
   | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Chrome Web Store | A Google Cloud OAuth client (type *Desktop*) with the Chrome Web Store API enabled; the refresh token from a one-time consent (`chrome-webstore-upload-keys` or the manual OAuth flow). |
   | `CWS_EXTENSION_ID` | Chrome Web Store | The item id from the developer dashboard URL. |
   | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | AMO | addons.mozilla.org → *Manage API Keys*. |

Store signing credentials and browser-store tokens stay outside the repository. A Git tag
identifies exactly the source used for submitted packages.

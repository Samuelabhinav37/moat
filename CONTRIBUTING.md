# Contributing to Moat

Thank you for helping improve Moat. Contributions should preserve its quiet user experience, least-privilege design, and compatibility across supported Chrome and Firefox releases.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run lint:firefox
```

Run rule validation after changing filters, manifests, or update scripts. Generated filter data should be reproducible and traceable to its upstream source.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Add tests for blocking, permissions, storage, or browser-compatibility changes.
- Document new permissions and justify why a narrower permission is insufficient.
- Do not include browsing data, private filter lists, credentials, or packaged extension artifacts.
- Update `CHANGELOG.md` for release-facing changes.

Report vulnerabilities privately according to `SECURITY.md`.

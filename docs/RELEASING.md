# Release Procedure

1. Start from a clean default branch and install dependencies with `npm ci`.
2. Run type checking, unit tests, rule validation, both browser builds, and Firefox extension linting.
3. Review permission changes and generated filter provenance.
4. Audit dependencies and document unresolved advisories that affect release tooling or runtime behavior.
5. Update the version and `CHANGELOG.md`.
6. Build browser packages from the reviewed commit and record their checksums.
7. Test unpacked packages in supported Chrome and Firefox versions before store submission.

Store signing credentials and browser-store tokens outside the repository. A Git tag should identify exactly the source used for submitted packages.

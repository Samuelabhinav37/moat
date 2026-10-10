# Security Policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Samuelabhinav37/moat/security/advisories/new). Do not disclose exploitable details in a public issue.

Include the affected browser and version, Moat version or commit, reproduction steps, observed impact, and a minimal proof of concept when safe.

## Scope

High-value reports include permission bypasses, extension-origin compromise, unsafe message passing, filter-update tampering, disclosure of browsing data, and blocking behavior that creates a security regression.

Third-party browser or filter-list vulnerabilities should also be reported to the relevant upstream maintainer. Avoid testing that disrupts services or accesses another person’s data.

## Known advisories in development tools

These affect only the tools used to build and test Moat. None of this code ships in the extension,
and neither package has a fixed version yet. They are rechecked before each release
(`docs/RELEASING.md`, step 4).

| Package | Advisory | Why it doesn't reach users |
| --- | --- | --- |
| `node-forge` (via `web-ext` → `@devicefarmer/adbkit`) | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), RSA PKCS#1 v1.5 signature verification | Loaded only by `web-ext run -t firefox-android` to talk to a phone over USB. Moat never verifies signatures with it. |
| `sprintf-js` (via `@adguard/dnr-rulesets`) | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), denial of service through precision specifiers | The build reads the package's prebuilt filter files. The code that uses `sprintf-js` never runs. |

## Supported versions

Security fixes target the latest published release and the current default branch. Older development builds may not receive backports.

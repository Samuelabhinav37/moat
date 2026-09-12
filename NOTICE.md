# Third-party notices

Moat's own code is [GPL-3.0](LICENSE). This file lists every third-party
license and data source bundled into the distributed extension, per each
license's own terms. See `README.md`'s "Licensing note" for the plain-English
summary and where each one is used in the code.

This file ships inside the built extension package (`chrome.zip`/`firefox.zip`),
not just the source repository, so the terms travel with every copy that's
actually distributed.

---

## AdGuard filter lists and `$redirect` resources -- GPL-3.0-only

Source: [AdguardTeam/AdguardFilters](https://github.com/AdguardTeam/AdguardFilters),
distributed via the `@adguard/dnr-rulesets` and `@adguard/scriptlets` npm
packages (both `GPL-3.0-only`/`GPL-3.0`). Compiled into `rules/dnr/*.json` by
`scripts/update-filters.mjs`. GPL-3.0 is compatible with Moat's own license by
design -- the combined work is distributed under the same terms, in full, as
`LICENSE` in this repository.

## uBlock Origin cosmetic filters ("Annoyances - others") -- GPL-3.0

Source: [uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets)
(`annoyances-others.txt`), GPL-3.0. Parsed for cosmetic (element-hiding) rules
only by `scripts/update-cosmetics.mjs`. Same compatibility as above.

## Ghostery TrackerDB -- CC-BY-NC-SA-4.0 (NON-COMMERCIAL)

Source: [ghostery/trackerdb](https://github.com/ghostery/trackerdb), via the
`@ghostery/trackerdb` npm package, licensed
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0**
(https://creativecommons.org/licenses/by-nc-sa/4.0/). Copyright 2017 Ghostery
GmbH. Used only to attribute a blocked domain to the company operating it
(`rules/dnr/rule-companies.json`, `rules/dnr/company-info.json`, the
Trackers/"By company" UI) -- informational only, no code from this package
ships.

**This license term is load-bearing and does not travel with a relicense of
Moat itself:** "NonCommercial" means not primarily intended for or directed
toward commercial advantage or monetary compensation. Moat's use is
compliant today because Moat has no ads, no paid tier, no sale, and no
monetary compensation tied to distribution. If that ever changes -- a paid
version, a sponsorship tied to the extension, selling the project, bundling
it with a commercial product -- this data source must be dropped or replaced
first, or a separate commercial license obtained directly from Ghostery.

## Consent-O-Matic -- MIT

Source: [cavi-au/Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic).
Two separate uses, both under the MIT terms below:

1. **Vendored rule data** (`rules/dnr/consent-rules.json`, via
   `scripts/vendor-consent-rules.mjs`) -- their `Rules.json`, used as-is.
2. **Ported interpreter** (`src/content/consent/*.ts`) -- Moat's own
   from-scratch TypeScript implementation of the same declarative
   action/matcher vocabulary their extension defines, not a copy of their
   source files. Written independently against their public rule schema.

```
MIT License

Copyright (c) 2019,2020,2021,2022 Janus Bager Kristensen and Rolf Bagge,
CAVI - Center for Advanced Visualization and Interaction, Aarhus University

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## NextDNS CNAME-cloaking destination list -- MIT

Source: [nextdns/cname-cloaking-blocklist](https://github.com/nextdns/cname-cloaking-blocklist),
vendored as-is by `scripts/vendor-cname-list.mjs` into
`rules/dnr/cname-cloak-destinations.json`.

```
MIT License

Copyright (c) 2022 NextDNS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## webextension-polyfill -- MPL-2.0

Source: [mozilla/webextension-polyfill](https://github.com/mozilla/webextension-polyfill),
Mozilla Public License 2.0. Used unmodified as a runtime dependency
(`node_modules/webextension-polyfill`, bundled into every entry point at
build time). MPL-2.0 is file-level copyleft and does not require the rest of
this repository to be relicensed; the polyfill's own license text travels
with its source file per MPL-2.0 Section 3.1, satisfied by linking to the
upstream repository above and keeping the dependency unmodified.

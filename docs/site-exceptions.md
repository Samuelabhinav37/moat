# Site exceptions

`live/site-exceptions.json` turns Moat down on one site for everyone, within a
day and without a store release. A person adds every entry. Nothing adds them
automatically.

## When to add one

The report service labels an issue in `moat-reports` with
`threshold:3-reporters` once 3 different people report the same site and
problem within 7 days. For a broken site or a cookie banner, it also posts a
draft entry. Read the reports before you use it:

- Fix the lists first if you can. A wrong rule is better removed from the
  lists or answered with a narrow `allow` in `live/quick-fixes.json`.
- Use an exception when the fix is "this site needs Moat to back off":
  a bank's device check, a sign-in page, a checkout.
- Never add one for a site on a danger list. The danger lists would still
  block it anyway, since they sit far above exceptions.

## The file

```json
{
  "format": 1,
  "sites": [
    { "site": "bank.example", "off": ["fingerprintResistance"], "issue": 123 },
    { "site": "shop.example", "allowRequests": true, "issue": 124 }
  ]
}
```

- `site`: a host name. The entry covers its subdomains too.
- `issue`: the `moat-reports` issue number. Required.
- `off`: features that default to off on the site. Any of
  `fingerprintResistance`, `cookieBannerAutoReject`,
  `aggressiveFeedAdRemoval`, `hideSeoSpamResults`. A choice the user made
  for that site still wins.
- `allowRequests: true`: the site's pages load everything, like a "Never
  block" entry but below it. Danger lists still block. Prefer `off` when it
  fixes the problem.

An entry with neither `off` nor `allowRequests`, or without `issue`, is
ignored. Moat also checks every entry itself (`src/shared/siteExceptions.ts`).

## Shipping it

1. Edit `live/site-exceptions.json` on a branch and open a pull request
   linking the issue. Don't touch `live/manifest.json`.
2. Merge it. `sign-live.yml` signs the manifest and publishes it.
3. Installs pick it up on their next daily check.

To remove an entry, delete it the same way. Installs drop it on their next
check.

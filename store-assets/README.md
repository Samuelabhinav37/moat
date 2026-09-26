# Store images

What gets uploaded to the Chrome Web Store (and reused for Firefox Add-ons).

| File | Size | Store slot |
|---|---|---|
| `1-ads.png` | 1280×800 | Screenshot 1: ads disappear before they load (weather.com without / with Moat) |
| `2-privacy.png` | 1280×800 | Screenshot 2: nothing leaves your browser (weather.com's real requests) |
| `3-popup.png` | 1280×800 | Screenshot 3: the popup, hanging from the toolbar icon |
| `4-cookies.png` | 1280×800 | Screenshot 4: cookie banners rejected (gov.uk without / with Moat) |
| `5-pause.png` | 1280×800 | Screenshot 5: pausing Moat on one site |
| `promo-tile-440x280.png` | 440×280 | Small promo tile (required) |
| `marquee-1400x560.png` | 1400×560 | Marquee (optional, for featured placement) |

Every screenshot is built from real captures of Moat in Chrome for Testing, kept in
`captures/`. The store shows screenshots at 584×365 and promo tiles at 208×133, so the
layouts use one-line headlines and one visual per frame.

## Rebuilding

- Wording or layout change: edit `scripts/store-images/build.mjs`, then `npm run store:build`.
- Fresh captures (after a UI change): `npm run build`, then
  `npm run store:capture -- some/review/folder` to capture somewhere safe first. Ads and counts
  change daily, so look before copying them into `captures/` and rebuilding.

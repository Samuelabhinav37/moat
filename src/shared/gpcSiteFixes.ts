// Sites where the Global Privacy Control signal breaks something real
// (checkout, booking, sign-in), so Moat doesn't send it there: neither the
// Sec-GPC header (scripts/update-filters.mjs) nor navigator.globalPrivacyControl
// (content/mainWorldGuard.ts). From Privacy Badger's pbconfig.json
// sitefixes.gpc (EFF, GPL-3.0, read 2026-10-14), which ships this list to
// every Privacy Badger user. Each entry also covers its subdomains.
export const GPC_SITE_FIXES = [
  "www.costco.com",
  "www.delta.com",
  "booking.flyfrontier.com",
  "www.flyfrontier.com",
  "gopro.com",
  "herafinejewelry.com",
  "www.madewell.com",
  "www.mazdausa.com",
];

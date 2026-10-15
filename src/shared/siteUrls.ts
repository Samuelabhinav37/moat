// Every address of Moat's own website, samuelabhinav.com/moat/. Built by
// scripts/site-build.mjs, which takes the same origin and base path from
// scripts/site/chrome.mjs (siteUrls.test.ts keeps the two equal).
// The live update channel is not here: it stays on GitHub Pages
// (background/liveUpdates.ts), where every installed copy fetches it.

export const SITE = "https://samuelabhinav.com/moat/";

export const SITE_URLS = {
  home: SITE,
  whatsNew: `${SITE}whats-new/`,
  privacy: `${SITE}privacy/`,
  support: `${SITE}support/`,
  faq: `${SITE}support/#faq`,
  licenses: `${SITE}licenses/`,
} as const;

/** What's New, scrolled to one version's entry (ids are v0-11-284). */
export function whatsNewUrl(version: string): string {
  return `${SITE_URLS.whatsNew}#v${version.replace(/\./g, "-")}`;
}

// Filter lists named for what they stop, the way people think about them
// ("Pop-up ads", "Phishing"), grouped into Ads, Tracking, Dangerous sites and
// Annoyances. The list's own published name stays on the row as its credit,
// so the source is never hidden. A list this table doesn't know (a new one
// added to update-filters.mjs) still shows, under its own name.

export type ListSection = "ads" | "tracking" | "security" | "annoyance";

export interface ListLabel {
  section: ListSection;
  nameKey: string;
  name: string;
  descKey: string;
  desc: string;
  icon: "ad" | "popup" | "globe" | "tracker" | "link" | "phishing" | "scam" | "malware" | "download" | "cookie" | "social" | "promo";
}

export const LIST_LABELS: Record<string, ListLabel> = {
  ads: { section: "ads", nameKey: "listAdsName", name: "Ads", descKey: "listAdsDesc", desc: "Banners, video ads and ad scripts.", icon: "ad" },
  popups: { section: "ads", nameKey: "listPopupsName", name: "Pop-up ads", descKey: "listPopupsDesc", desc: "New tabs and pop-unders.", icon: "popup" },
  oisd: { section: "ads", nameKey: "listOisdName", name: "Extra ad and tracker sites", descKey: "listOisdDesc", desc: "Catches what the lists above miss.", icon: "globe" },
  trackers: { section: "tracking", nameKey: "listTrackersName", name: "Trackers", descKey: "listTrackersDesc", desc: "Analytics and ad-tech scripts.", icon: "tracker" },
  "url-tracking": { section: "tracking", nameKey: "listUrlTrackingName", name: "Tracking in links", descKey: "listUrlTrackingDesc", desc: "Strips click IDs from links.", icon: "link" },
  "phishing-urls": { section: "security", nameKey: "listPhishingName", name: "Phishing", descKey: "listPhishingDesc", desc: "Fake sign-in pages.", icon: "phishing" },
  scam: { section: "security", nameKey: "listScamName", name: "Scams", descKey: "listScamDesc", desc: "Fake shops and giveaways.", icon: "scam" },
  "malicious-urls": { section: "security", nameKey: "listMalwareName", name: "Malware", descKey: "listMalwareDesc", desc: "Sites that spread viruses.", icon: "malware" },
  badware: { section: "security", nameKey: "listBadwareName", name: "Risky downloads", descKey: "listBadwareDesc", desc: "Bundled and fake software.", icon: "download" },
  "cookie-notices": { section: "annoyance", nameKey: "listCookieName", name: "Cookie banners", descKey: "listCookieDesc", desc: "Hides banners Moat can't reject.", icon: "cookie" },
  "social-widgets": { section: "annoyance", nameKey: "listSocialName", name: "Social buttons", descKey: "listSocialDesc", desc: "Like and Share widgets.", icon: "social" },
  annoyances: { section: "annoyance", nameKey: "listPromoName", name: "Promos and copy blockers", descKey: "listPromoDesc", desc: "Newsletter boxes and no-copy scripts.", icon: "promo" },
};

export const SECTION_ORDER: readonly ListSection[] = ["ads", "tracking", "security", "annoyance"];

export const SECTION_TITLES: Record<ListSection, { key: string; fallback: string }> = {
  ads: { key: "listSectionAds", fallback: "Ads" },
  tracking: { key: "listSectionTracking", fallback: "Tracking" },
  security: { key: "listSectionSecurity", fallback: "Dangerous sites" },
  annoyance: { key: "listSectionAnnoyance", fallback: "Annoyances" },
};

/** Where a list goes: its label's section, or by the manifest's own category. */
export function sectionFor(group: string, category: string): ListSection {
  const known = LIST_LABELS[group];
  if (known) return known.section;
  return category === "security" ? "security" : category === "annoyance" ? "annoyance" : "ads";
}

/** Lists grouped by section in a fixed order, each section keeping the
 * table's order (unknown lists last, by size). */
export function groupLists<T extends { group: string; category: string; entryCount: number }>(lists: readonly T[]): { section: ListSection; lists: T[] }[] {
  const order = Object.keys(LIST_LABELS);
  const rank = (l: T) => {
    const i = order.indexOf(l.group);
    return i === -1 ? order.length : i;
  };
  return SECTION_ORDER.map((section) => ({
    section,
    lists: lists.filter((l) => sectionFor(l.group, l.category) === section).sort((a, b) => rank(a) - rank(b) || b.entryCount - a.entryCount),
  })).filter((g) => g.lists.length > 0);
}

// Pure metadata + scoping logic for the Diagnostics page's Heuristics
// section (DR-16). Kept free of any webextension-polyfill import, same
// convention as usageStatsState.ts/customRuleStats.ts, so it's testable
// without a browser extension context.
//
// heuristicAppliesTo answers "does this heuristic have anything to do on
// this hostname?" -- required, not optional. Without it every heuristic
// would read "silent" on every page (a feed scanner reported as broken on
// a site it never touches), and reporting that as a fault makes the whole
// surface noise. It's a predicate over each heuristic's own match
// conditions (the content-script registration patterns in
// scripts/manifest.ts / background/optionalContentScripts.ts), not stored
// data -- nothing here is persisted.
import type { Settings, UsageSignal } from "../types";

export interface HeuristicScopeDef {
  id: UsageSignal;
  settingKey: keyof Settings;
  titleKey: readonly [string, string];
}

// One entry per UsageSignal that has a real content-script heuristic behind
// it (as opposed to cnameUncloak/fingerprint, which run through
// declarativeNetRequest/privacy APIs with no page-content dependency, but
// still have an on/off setting worth surfacing here).
export const HEURISTIC_DEFS: readonly HeuristicScopeDef[] = [
  {
    id: "grayscaleAds",
    settingKey: "grayscaleUnblockableAds",
    titleKey: ["optionsGrayscaleToggleLabel", "Gray out unblockable video ads"],
  },
  {
    id: "feedAdRemoval",
    settingKey: "aggressiveFeedAdRemoval",
    titleKey: ["optionsFeedScanToggleLabel", "Hide sponsored posts in feeds"],
  },
  {
    id: "cookieBannerReject",
    settingKey: "cookieBannerAutoReject",
    titleKey: ["optionsConsentRejectToggleLabel", "Auto-reject cookie banners"],
  },
  {
    id: "searchSlop",
    settingKey: "hideSeoSpamResults",
    titleKey: ["optionsSearchSlopToggleLabel", "Hide low-quality search results"],
  },
  {
    id: "leakedPasswordCheck",
    settingKey: "leakedPasswordCheck",
    titleKey: ["optionsLeakedPasswordToggleLabel", "Check passwords against known breaches"],
  },
  {
    id: "fingerprint",
    settingKey: "fingerprintResistance",
    titleKey: ["optionsFingerprintToggleLabel", "Stop sites recognizing your device"],
  },
  {
    id: "cnameUncloak",
    settingKey: "cnameUncloaking",
    titleKey: ["optionsCnameToggleLabel", "Catch trackers hiding in disguise"],
  },
];

// content_scripts matches in scripts/manifest.ts.
const YOUTUBE_HOSTNAMES = new Set(["www.youtube.com", "m.youtube.com"]);
const FEED_SCANNER_HOSTNAMES = new Set(["www.instagram.com", "www.linkedin.com", "www.youtube.com", "m.youtube.com"]);
// The real match patterns also require a /search-ish path
// ("*://www.google.com/search*"); this predicate only gets a hostname, so
// it's a deliberate over-approximation -- any page on these hostnames counts
// as "applies here", not just the results page itself.
const SEARCH_RESULTS_HOSTNAMES = new Set(["www.google.com", "www.bing.com", "duckduckgo.com"]);

export function heuristicAppliesTo(kind: UsageSignal, hostname: string): boolean {
  switch (kind) {
    case "grayscaleAds":
      return YOUTUBE_HOSTNAMES.has(hostname);
    case "feedAdRemoval":
      return FEED_SCANNER_HOSTNAMES.has(hostname);
    case "searchSlop":
      return SEARCH_RESULTS_HOSTNAMES.has(hostname);
    // cookieBannerReject and leakedPasswordCheck are registered on every
    // page while their setting is on (background/optionalContentScripts.ts
    // has no domain restriction) -- whether a given page actually has a
    // consent banner or a password field is DOM content this background-
    // side predicate has no way to see, so both count as "applies
    // everywhere" and fall back to the fired/silent distinction instead.
    // fingerprint resistance and CNAME uncloaking run on every navigation
    // the same way.
    default:
      return true;
  }
}

// "Changed for one site" on the Sites screen: the settings someone turned on
// or off for a single site from the popup's "Customize for this site"
// (Settings.perSiteOverrides). Before this list, the only way to see or undo
// one was to go back to that site and open the popup there.

import { OVERRIDABLE_KEYS, type OverridableSettingKey } from "../shared/perSiteOverrides";
import type { Settings } from "../types";

export interface SiteOverrideEntry {
  hostname: string;
  changes: { key: OverridableSettingKey; value: boolean }[];
}

/** Sites with at least one override, sorted by name ignoring a leading
 * "www.", each with its overrides in the popup's order. */
export function siteOverrideEntries(overrides: Settings["perSiteOverrides"]): SiteOverrideEntry[] {
  const bare = (hostname: string) => hostname.replace(/^www\./i, "");
  return Object.entries(overrides)
    .map(([hostname, values]) => ({
      hostname,
      changes: OVERRIDABLE_KEYS.flatMap((key) => {
        const value = values?.[key];
        return typeof value === "boolean" ? [{ key, value }] : [];
      }),
    }))
    .filter((entry) => entry.changes.length > 0)
    .sort((a, b) => bare(a.hostname).localeCompare(bare(b.hostname)));
}

/** The popup's own names for these settings, so both places say the same. */
export const OVERRIDE_NAMES: Record<OverridableSettingKey, readonly [string, string]> = {
  fingerprintResistance: ["popupOverrideFingerprint", "Stop sites recognizing your device"],
  cookieBannerAutoReject: ["popupOverrideCookieBanner", "Reject cookie banners"],
  aggressiveFeedAdRemoval: ["popupOverrideFeedAds", "Hide sponsored posts"],
  hideSeoSpamResults: ["popupOverrideSeoSpam", "Hide low-quality search results"],
};

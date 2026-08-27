// Filtering-level presets shown at the top of the Filter Lists tab, and
// (lite only) applied automatically on a genuine fresh install -- see
// background/settings.ts's applyFreshInstallDefaults(). Pure module (no
// browser APIs) so it's directly unit-testable, and shared rather than
// options-only since the background bundle needs "lite" too.
import type { Settings } from "../types";

export const ALL_TOGGLEABLE_GROUPS = [
  "ads",
  "trackers",
  "url-tracking",
  "popups",
  "malicious-urls",
  "phishing-urls",
  "scam",
  "badware",
  "social-widgets",
  "cookie-notices",
  "annoyances",
] as const;

const SECURITY_AND_ADS = ["ads", "popups", "malicious-urls", "phishing-urls", "scam", "badware"];

// Same as essential, minus phishing-urls (Moat's single largest security
// list at ~64,600 rules). Not a hand-picked ideal blocklist -- it exists
// purely to give a fresh install a smaller starting footprint (~89,000 rules
// vs. essential's ~154,000, vs. every group on by default at ~276,000) so
// it's less likely to blow past whatever's left of the browser's shared
// static-rule budget (see README's Known Limitations section). Still real
// ad+malware+scam blocking, just without the one list that costs the most.
const LITE_GROUPS = SECURITY_AND_ADS.filter((group) => group !== "phishing-urls");

interface PresetDefinition {
  filterGroups: Record<string, boolean>;
  webrtcLeakProtection: boolean;
  blockThirdPartyCookies: boolean;
  fingerprintResistance: boolean;
}

function groupMap(onGroups: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(ALL_TOGGLEABLE_GROUPS.map((group) => [group, onGroups.includes(group)]));
}

export const PRESETS: Record<"lite" | "essential" | "standard" | "strict", PresetDefinition> = {
  lite: {
    filterGroups: groupMap(LITE_GROUPS),
    webrtcLeakProtection: false,
    blockThirdPartyCookies: false,
    fingerprintResistance: false,
  },
  essential: {
    filterGroups: groupMap(SECURITY_AND_ADS),
    webrtcLeakProtection: false,
    blockThirdPartyCookies: false,
    fingerprintResistance: false,
  },
  standard: {
    filterGroups: groupMap([...SECURITY_AND_ADS, "trackers", "url-tracking"]),
    webrtcLeakProtection: false,
    blockThirdPartyCookies: false,
    fingerprintResistance: false,
  },
  strict: {
    filterGroups: groupMap(ALL_TOGGLEABLE_GROUPS),
    webrtcLeakProtection: true,
    blockThirdPartyCookies: true,
    fingerprintResistance: true,
  },
};

export type PresetName = "off" | keyof typeof PRESETS;

/** Applies cleanly to a Partial<Settings> patch for setSettings(). "off" only flips the master switch. */
export function presetPatch(name: PresetName): Partial<Settings> {
  if (name === "off") return { enabled: false };
  const preset = PRESETS[name];
  return { enabled: true, ...preset };
}

function normalizedGroups(filterGroups: Settings["filterGroups"]): Record<string, boolean> {
  return Object.fromEntries(ALL_TOGGLEABLE_GROUPS.map((group) => [group, filterGroups[group] ?? true]));
}

function sameGroups(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  return ALL_TOGGLEABLE_GROUPS.every((group) => a[group] === b[group]);
}

/** Which preset (if any) the current settings exactly match -- "custom" once the user hand-tweaks something. */
export function detectPreset(settings: Settings): PresetName | "custom" {
  if (!settings.enabled) return "off";

  const current = normalizedGroups(settings.filterGroups);
  for (const [name, preset] of Object.entries(PRESETS) as [PresetName, PresetDefinition][]) {
    const matches =
      sameGroups(current, preset.filterGroups) &&
      settings.webrtcLeakProtection === preset.webrtcLeakProtection &&
      settings.blockThirdPartyCookies === preset.blockThirdPartyCookies &&
      settings.fingerprintResistance === preset.fingerprintResistance;
    if (matches) return name;
  }
  return "custom";
}

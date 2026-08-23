// Filtering-level presets shown at the top of the Filter Lists tab. Pure
// module (no browser APIs) so it's directly unit-testable.
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

export interface PresetDefinition {
  filterGroups: Record<string, boolean>;
  webrtcLeakProtection: boolean;
  blockThirdPartyCookies: boolean;
  fingerprintResistance: boolean;
}

function groupMap(onGroups: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(ALL_TOGGLEABLE_GROUPS.map((group) => [group, onGroups.includes(group)]));
}

export const PRESETS: Record<"essential" | "standard" | "strict", PresetDefinition> = {
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

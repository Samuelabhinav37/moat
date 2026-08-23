export interface Settings {
  /** Hostnames where protection is fully paused. */
  disabledSites: string[];
  /** Master on/off switch. */
  enabled: boolean;
  /**
   * Browser-wide toggles via the `privacy` API, applied via
   * background/privacySettings.ts. Off by default: unlike everything else
   * in this extension, these change behavior outside of what's on-screen,
   * so they need an explicit opt-in rather than being silently on.
   */
  webrtcLeakProtection: boolean;
  blockThirdPartyCookies: boolean;
  /**
   * Canvas/AudioContext/WebGL noise + navigator property bucketing. Off by
   * default: unlike blocking, this can occasionally change what a page
   * observes (e.g. a canvas-based CAPTCHA), so it needs an explicit opt-in.
   */
  fingerprintResistance: boolean;
  /** Generated once per install (see background/settings.ts), empty until then. */
  fingerprintSeed: string;
}

export const DEFAULT_SETTINGS: Settings = {
  disabledSites: [],
  enabled: true,
  webrtcLeakProtection: false,
  blockThirdPartyCookies: false,
  fingerprintResistance: false,
  fingerprintSeed: "",
};

export const STORAGE_KEY = "settings";

export type GuardBlockKind = "window-open" | "synthetic-click";

export interface BlockedMessage {
  type: "blocked";
  kind: GuardBlockKind;
  url: string | null;
}

export interface GetStatusMessage {
  type: "get-status";
}

export interface StatusResponse {
  hostname: string;
  siteDisabled: boolean;
  enabled: boolean;
  blockedOnTab: number;
}

export interface ToggleSiteMessage {
  type: "toggle-site";
  hostname: string;
  disabled: boolean;
}

export interface SetEnabledMessage {
  type: "set-enabled";
  enabled: boolean;
}

export type RuntimeMessage =
  | BlockedMessage
  | GetStatusMessage
  | ToggleSiteMessage
  | SetEnabledMessage;

/** Message shape used on the window.postMessage bridge between the MAIN
 * world guard(s) and the isolated-world content script (postMessage is the
 * only channel a MAIN-world script has, since it has no extension APIs). */
export type BridgeMessage =
  | { source: "silent-adblock"; type: "config"; disabled: boolean; fingerprintResistance: boolean; fingerprintSeed: string }
  | { source: "silent-adblock"; type: "blocked"; kind: GuardBlockKind; url: string | null };

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
}

export const DEFAULT_SETTINGS: Settings = {
  disabledSites: [],
  enabled: true,
  webrtcLeakProtection: false,
  blockThirdPartyCookies: false,
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
 * world guard and the isolated-world content script (postMessage is the
 * only channel a MAIN-world script has, since it has no extension APIs). */
export type BridgeMessage =
  | { source: "silent-adblock"; type: "config"; disabled: boolean }
  | { source: "silent-adblock"; type: "blocked"; kind: GuardBlockKind; url: string | null };

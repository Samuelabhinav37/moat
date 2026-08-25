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
  /**
   * Per-filter-list overrides, keyed by the group slug in rules/manifest.json
   * (e.g. "ads", "trackers", "cookie-notices"). Only stores what the user
   * actually changed -- a group with no entry here keeps whatever `enabled`
   * state it shipped with, so we never have to reconcile all 18 rulesets on
   * every startup, only the ones someone touched.
   */
  filterGroups: Record<string, boolean>;
  /** Extra domains to block outright, beyond the bundled filter lists. */
  customBlockedDomains: string[];
  /** Exceptions -- never block these, even if a filter list or custom block rule would. */
  customAllowedDomains: string[];
  /** Element-picker picks that should persist -- hostname -> CSS selectors to hide there. */
  customCosmeticRules: Record<string, string[]>;
  /** Same shape as customCosmeticRules, but grayed out (filter: grayscale)
   * instead of hidden -- for elements picked to tone down, not remove. */
  customGrayscaleRules: Record<string, string[]>;
  /**
   * Best-effort dimming of in-stream video ads on YouTube (they share the
   * same player as real content, so they can't be blocked outright) --
   * see content/youtubeAdDimmer.ts. On by default: verified live against a
   * real ad (2026-08-23) using two independent DOM signals. Still a
   * heuristic tied to YouTube's current markup, not a guaranteed mechanism,
   * so it stays a real toggle rather than being unconditional.
   */
  grayscaleUnblockableAds: boolean;
  /**
   * Continuously scans Instagram and YouTube feeds for the literal
   * "Sponsored"/"Ad"/"Paid partnership" label as new posts render (infinite
   * scroll), and hides the whole post -- catches sponsored content whose
   * class names are randomized specifically to defeat fixed selectors. Off
   * by default: a text-label match, not a fixed rule, so it carries a
   * small false-positive risk a fixed selector doesn't -- opt in if you
   * want feeds fully cleaned rather than just what static rules catch.
   */
  aggressiveFeedAdRemoval: boolean;
  /**
   * Auto-clicks the "reject"/"decline" path on cookie-consent banners
   * using a small interpreter for Consent-O-Matic's declarative rule
   * format (inert JSON describing which selector to click, never
   * arbitrary injected JS) -- see content/consentRejector.ts. Off by
   * default: it's still clicking things on a page on your behalf, closer
   * in kind to the aggressive feed scanner above than to plain cosmetic
   * hiding.
   */
  cookieBannerAutoReject: boolean;
  /**
   * Firefox-only real CNAME uncloaking via browser.dns.resolve() -- see
   * background/cnameUncloak.ts. Chrome has no equivalent API at all, a
   * hard platform gap, not a toggle Moat can offer there. Off by default:
   * it's a per-candidate-request DNS resolution, a different (if small)
   * cost/trust profile than everything else here.
   */
  cnameUncloaking: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  disabledSites: [],
  enabled: true,
  webrtcLeakProtection: false,
  blockThirdPartyCookies: false,
  fingerprintResistance: false,
  fingerprintSeed: "",
  filterGroups: {},
  customBlockedDomains: [],
  customAllowedDomains: [],
  customCosmeticRules: {},
  customGrayscaleRules: {},
  grayscaleUnblockableAds: true,
  aggressiveFeedAdRemoval: false,
  cookieBannerAutoReject: false,
  cnameUncloaking: false,
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
  /** Real counts from declarativeNetRequest's own match feedback (Chrome
   * only -- see background/matchStats.ts) plus the popup/redirect firewall's
   * real-time catches, folded into "popups". */
  breakdown: { ads: number; trackers: number; popups: number };
  /** Optional "by company" detail for the same tab (company name -> count),
   * sourced from Ghostery's TrackerDB -- see shared/matchedRuleCompanies.ts.
   * Most blocked requests have no entry; empty object when none apply. */
  companyBreakdown: Record<string, number>;
}

export interface ToggleSiteMessage {
  type: "toggle-site";
  hostname: string;
  disabled: boolean;
}

/** Sent by elementPicker.ts (content script) -- kept as an explicit message rather than
 * importing the full settings module into that content script's bundle. */
export interface SaveCosmeticRuleMessage {
  type: "save-cosmetic-rule";
  hostname: string;
  selector: string;
}

/** Same idea as SaveCosmeticRuleMessage, for the picker's "Gray out" mode. */
export interface SaveGrayscaleRuleMessage {
  type: "save-grayscale-rule";
  hostname: string;
  selector: string;
}

/** One declarativeNetRequest.onRuleMatchedDebug match, kept for the
 * diagnostic logger page (src/logger/). This event only fires for
 * extensions loaded unpacked (Chrome dev mode), never a Web Store install --
 * see background/ruleLogger.ts. */
export interface LoggedMatch {
  timestamp: number;
  url: string;
  method: string;
  /** chrome.declarativeNetRequest.RequestDetails.type, e.g. "script"/"image"/"xmlhttprequest". */
  type: string;
  ruleId: number;
  rulesetId: string;
}

export interface GetLogEntriesMessage {
  type: "get-log-entries";
}

export interface LogEntriesResponse {
  /** False when chrome.declarativeNetRequest.onRuleMatchedDebug doesn't
   * exist -- a Web Store/production build, Firefox, or Chrome without dev
   * mode -- so the logger page can show a clear reason instead of an empty
   * list. */
  supported: boolean;
  hostname: string;
  entries: LoggedMatch[];
}

export type RuntimeMessage =
  | BlockedMessage
  | GetStatusMessage
  | ToggleSiteMessage
  | SaveCosmeticRuleMessage
  | SaveGrayscaleRuleMessage
  | GetLogEntriesMessage;

/** Message shape used on the window.postMessage bridge between the MAIN
 * world guard(s) and the isolated-world content script (postMessage is the
 * only channel a MAIN-world script has, since it has no extension APIs). */
export type BridgeMessage =
  | {
      source: "moat";
      type: "config";
      disabled: boolean;
      fingerprintResistance: boolean;
      fingerprintSeed: string;
      guardToken: string;
    }
  | { source: "moat"; type: "blocked"; kind: GuardBlockKind; url: string | null };

/**
 * Read-only policy an org can push via Chrome's ExtensionSettings policy or
 * Firefox's policies.json 3rdparty key (see managed_schema.json). Kept
 * separate from Settings -- it's never written by the extension, only read.
 */
export interface ManagedPolicy {
  forceEnabled?: boolean;
  lockProtectionToggle?: boolean;
  lockFilterGroups?: boolean;
  managedFilterGroups?: Record<string, boolean>;
  /** Merged in ADDITION to the user's own customBlockedDomains, not replacing it. */
  managedCustomBlockedDomains?: string[];
}

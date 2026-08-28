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
   * Off by default (fingerprintSeed above, reused forever, is the default).
   * When on, bridge.ts uses a seed from browser.storage.session instead --
   * fresh each browser restart, closer to Brave's model -- since a
   * fingerprint that never changes can itself become a durable identifier.
   * Only has an effect when fingerprintResistance is also on.
   */
  fingerprintRotatePerSession: boolean;
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
  /**
   * Mirrors settings (excluding fingerprintSeed) to browser.storage.sync so
   * a fresh install can seed itself from an existing synced copy -- see
   * settings.ts's seedFromSyncIfEmpty(). Off by default: this sends your
   * custom rules/filter choices through your browser's own sync account,
   * a real behavior change outside what's on-screen. Last-write-wins, no
   * live cross-device merge -- not a real-time sync engine.
   */
  syncEnabled: boolean;
  /**
   * Checks password field values against HIBP's Pwned Passwords k-anonymity
   * API (only a 5-character SHA-1 prefix ever leaves the device -- see
   * content/leakedPasswordCheck.ts) on blur/submit, and shows a non-blocking
   * inline warning if a match is found. Off by default: this is a network
   * request containing a hash derived from what the user typed, a materially
   * different trust boundary than anything else in this extension, even
   * though HIBP's own k-anonymity design means the full password/hash is
   * never transmitted.
   */
  leakedPasswordCheck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  disabledSites: [],
  enabled: true,
  webrtcLeakProtection: false,
  blockThirdPartyCookies: false,
  fingerprintResistance: false,
  fingerprintSeed: "",
  fingerprintRotatePerSession: false,
  filterGroups: {},
  customBlockedDomains: [],
  customAllowedDomains: [],
  customCosmeticRules: {},
  customGrayscaleRules: {},
  grayscaleUnblockableAds: true,
  aggressiveFeedAdRemoval: false,
  cookieBannerAutoReject: false,
  cnameUncloaking: false,
  syncEnabled: false,
  leakedPasswordCheck: false,
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

export interface GetReportContextMessage {
  type: "get-report-context";
}

export interface ExportSettingsMessage {
  type: "export-settings";
}

export interface ImportSettingsMessage {
  type: "import-settings";
  payload: unknown;
}

export interface ImportSettingsResponse {
  ok: boolean;
}

export interface GetUiNoticesMessage {
  type: "get-ui-notices";
}

export interface DismissUpdateNoticeMessage {
  type: "dismiss-update-notice";
}

export interface DismissOnboardingMessage {
  type: "dismiss-onboarding";
}

/** Deliberately hostname-only, not the full URL -- avoids leaking a page's
 * tracking/session query-string params into a public GitHub issue body. */
export interface ReportContextResponse {
  hostname: string;
  /** Human-readable names of filter groups currently enabled globally (not
   * per-request match data, which is Chrome-only via getMatchedRules -- this
   * stays cheap and identical on both browsers). */
  enabledFilterGroups: string[];
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

/** Sent by warning.ts on load -- only ever reachable at all when an org's
 * Athena-pushed policy named the domain that redirected here, so this is
 * never exercised on a normal install. */
export interface GetAthenaBlockReasonMessage {
  type: "get-athena-block-reason";
}

export interface AthenaBlockReasonResponse {
  /** Null if the sending tab has no recorded reason -- e.g. warning.html
   * opened directly rather than via an actual policy redirect. The page
   * shows a generic message rather than guessing a hostname in that case. */
  hostname: string | null;
}

export interface ReportAthenaOverrideMessage {
  type: "report-athena-override";
  reason: string;
}

export type RuntimeMessage =
  | BlockedMessage
  | GetStatusMessage
  | ToggleSiteMessage
  | SaveCosmeticRuleMessage
  | SaveGrayscaleRuleMessage
  | GetLogEntriesMessage
  | GetReportContextMessage
  | ExportSettingsMessage
  | ImportSettingsMessage
  | GetUiNoticesMessage
  | DismissUpdateNoticeMessage
  | DismissOnboardingMessage
  | GetAthenaBlockReasonMessage
  | ReportAthenaOverrideMessage;

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
  /**
   * Present only when an org has deployed Moat alongside a self-hosted
   * Athena instance (see background/athenaIntegration.ts) -- absent for
   * every normal/open-source install, since it can only ever arrive via
   * chrome.storage.managed, which nothing but an org's own MDM/Group
   * Policy can populate. Nothing in this object is ever read, written, or
   * offered as a Settings toggle outside of that -- there's no user-facing
   * path that could turn this on by accident.
   */
  athena?: AthenaConfig;
}

/** See ManagedPolicy.athena. Every field is required -- a partially-set
 * object is treated as "not configured" by isAthenaConfigured() rather
 * than attempted with missing pieces. */
export interface AthenaConfig {
  /** Identifies this org's data to a multi-tenant Athena instance; never
   * used to look anything up locally. */
  tenantId: string;
  /** Immutable Athena security_agents identifier returned during enrollment. */
  agentId: string;
  /** POSTed to once (or again after the returned token expires) with
   * { tenant_id, agent_id, enrollment_secret } -- Athena's real
   * /v1/security/agent-token request shape -- to exchange bootstrapSecret
   * for a short-lived session token. See athenaIntegration.ts. Never
   * Moat's own domain. */
  bootstrapUrl: string;
  /** A shared secret provisioned by the org's Athena deployment, scoped to
   * this org only. Only ever held in browser.storage.managed (read-only,
   * OS-policy-populated) and briefly in memory during the exchange above --
   * never written to storage.local/sync, which aren't encrypted at rest. */
  bootstrapSecret: string;
  /** Where minimized security events (see AthenaSecurityEvent) are POSTed,
   * batched, using the session token from the exchange above. */
  eventsUrl: string;
  /**
   * Optional -- policy distribution (org-pushed blocked domains beyond the
   * bundled filter lists) only runs when BOTH this and policyPublicKey are
   * set; event reporting above works independently of these two. Fetched
   * on the same interval as the event flush -- see athenaPolicySync.ts.
   */
  policyUrl?: string;
  /**
   * Optional, paired with policyUrl. An Ed25519 public key (JWK) used
   * to verify every fetched policy artifact's signature before it's ever
   * trusted -- see shared/athenaPolicySignature.ts. A fetch that fails
   * signature verification is discarded outright; whatever policy was
   * last successfully verified stays active, the same fail-safe posture
   * liveUpdates.ts already has for an unreachable/malformed daily fetch.
   */
  policyPublicKey?: JsonWebKey;
}

/**
 * What policyUrl serves, once its envelope's signature verifies. Kept
 * intentionally narrow -- block-only, domain-shaped -- for the same reason
 * quickFixRules.ts's remote channel is narrow: this is fetched content an
 * org's own Athena deployment controls, not Moat's, and a payload shape
 * that could redirect traffic to an arbitrary target is not a risk worth
 * taking for what this channel is for.
 */
export interface AthenaPolicyArtifact {
  version: number;
  issuedAt: number;
  blockedDomains: string[];
}

/** The envelope actually fetched from policyUrl: `payload` is the exact,
 * verbatim JSON-stringified AthenaPolicyArtifact the signature was computed
 * over -- reconstructed client-side via canonicalPolicyPayload(), since
 * Athena's real response returns `policy` as a parsed object, not a
 * pre-serialized string -- and `signature` is that Ed25519 signature,
 * base64. */
export interface SignedAthenaPolicy {
  payload: string;
  signature: string;
}

/**
 * The wire format for a single batched event sent to eventsUrl. Deliberately
 * minimal -- no URLs, page content, or browsing history, matching the same
 * k-anonymity-style minimization already used for the leaked-password check.
 * See docs/research (Moat repo) / planning docs (cross-project) for the
 * "Athena Security Event v1" schema this implements.
 */
export interface AthenaSecurityEvent {
  eventId: string;
  timestamp: number;
  /** What kind of local decision produced this event. "security-rule" is a
   * declarativeNetRequest match against the malicious-urls/phishing-urls/
   * scam/badware filter groups specifically -- not ordinary ad/tracker
   * blocking, which never generates an event. "popup-redirect" is the
   * background tab-safety-net closing a hijacked tab -- the one source that
   * also works on Firefox, where getMatchedRules doesn't exist. "override"
   * is a user clicking through the warning interstitial (see warning.ts)
   * for a domain blocked by an Athena-pushed policy specifically -- never
   * generated for the bundled consumer filter lists, which don't show that
   * page at all. */
  category: "security-rule" | "popup-redirect" | "override";
  /** "high" for malicious-urls/phishing-urls/scam, "medium" for badware
   * (see shared/securityRuleCategories.ts) or popup-redirect, "low" for an
   * override (a human decision, not a detection). */
  riskTier: "high" | "medium" | "low";
  /** Opaque identifiers into the bundled ruleset that matched, not the
   * domain itself -- resolving these to an actual hostname is a real
   * follow-up (see planning notes), deliberately not done yet: it would
   * mean bundling or fetching full rule content just to read it back out,
   * a materially bigger privacy/complexity step than shipping ruleId
   * references, which say nothing on their own without the same ruleset
   * data Athena would need to already have out-of-band. */
  rulesetId?: string;
  ruleId?: number;
  /**
   * The one place free text can reach this event -- only ever set by a
   * user's own typed reason on the warning interstitial's "Report mistake"
   * override, length-capped there. Absent on every other category.
   */
  note?: string;
  /**
   * Only set for category "override" -- unlike rulesetId/ruleId above, this
   * is safe to include as a real hostname rather than an opaque reference:
   * it's a domain the org's own Athena instance already named in its policy
   * artifact (see AthenaPolicyArtifact.blockedDomains), not anything new
   * being disclosed to it.
   */
  domain?: string;
}

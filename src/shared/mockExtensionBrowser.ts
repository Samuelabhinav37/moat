// Test-only. A webextension-polyfill-shaped mock, comprehensive enough to
// load the real options.ts/popup.ts against a real DOM in jsdom (see
// options.render.test.ts / popup.render.test.ts) -- adapted from the ad-hoc
// mock built by hand to find the v0.11.89 bugs, now a permanent fixture so
// that class of bug gets caught by `npm test` instead of a manual pass.
// Nothing in src/ imports this outside those two test files; it's never
// bundled into a real entry point.
import { DEFAULT_SETTINGS, type Settings } from "../types";

function callbackOrPromise<T>(result: T) {
  return (...args: unknown[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === "function") (callback as (v: T) => void)(result);
    return Promise.resolve(result);
  };
}

export interface MockBrowserOptions {
  /** Overrides layered onto DEFAULT_SETTINGS -- deliberately includes
   * perSiteOverrides/customCosmeticRules/etc. by default so both pages
   * render their fuller, more representative states, not an empty one. */
  settings?: Partial<Settings>;
  hostname?: string;
}

/** A realistic, non-empty settings/usage fixture -- rendering an empty state
 * would hide most of the DOM this check needs to walk (empty lists render no
 * text at all, so they can't be invisible). */
export function createMockBrowser(options: MockBrowserOptions = {}) {
  const hostname = options.hostname ?? "example.com";
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    enabled: true,
    fingerprintResistance: true,
    cookieBannerAutoReject: true,
    hideSeoSpamResults: true,
    blockThirdPartyCookies: true,
    grayscaleUnblockableAds: true,
    leakedPasswordCheck: true,
    permissionGuardCamera: true,
    disabledSites: ["paused.example"],
    customCosmeticRules: { [hostname]: [".ad-slot"] },
    customGrayscaleRules: { [hostname]: [".video-ad"] },
    perSiteOverrides: { [hostname]: { hideSeoSpamResults: false } },
    ...options.settings,
  };

  const storageLocalData: Record<string, unknown> = {
    settings,
    usageStats: {
      days: {
        "2026-01-01": {
          date: "2026-01-01",
          total: 120,
          hostnames: [hostname],
          signals: { fingerprint: { count: 3, hostnames: [hostname] } },
          companies: { "Google LLC": { count: 5, hostnames: [hostname] } },
        },
      },
    },
    customRuleStats: {
      [`hide:${hostname}:.ad-slot`]: { hitCount: 12, lastMatchedAt: Date.now(), createdAt: Date.now() },
    },
    filterGroupStatus: { ok: true, availableStaticRuleCount: 40000 },
    liveUpdateStatus: { ok: true, timestamp: Date.now(), domainCount: 465 },
    youtubeQuickFixesStatus: { ok: true, timestamp: Date.now(), selectorCount: 2 },
    syncStatus: null,
  };

  const sendMessageHandlers: Record<string, (msg: Record<string, unknown>) => unknown> = {
    "get-filter-list-matches": () => ({ hostname, matchesByGroup: { ads: 5, trackers: 2 }, supported: true }),
    "get-company-breakdown": () => ({ hostname, companyBreakdown: { "Google LLC": 5 }, supported: true }),
    "export-settings": () => settings,
    "start-element-picker": () => ({ ok: true }),
    "check-for-live-updates": () => undefined,
    "get-status": () => ({
      hostname,
      siteDisabled: false,
      enabled: true,
      blockedOnTab: 12,
      breakdown: { ads: 5, trackers: 2, popups: 1 },
      companyBreakdown: { "Google LLC": 5 },
      droppedFilterGroups: [],
      permissionGuard: { camera: true, microphone: false, location: false },
    }),
    "get-ui-notices": () => ({ showOnboarding: false, updateAvailable: false, updateVersion: "" }),
    "get-report-context": () => ({ hostname }),
    // A representative mix of all three heuristic-row states (DR-16) plus
    // one out-of-scope heuristic, so a render test can exercise fired/
    // silent/off/excluded in one pass -- see logger.render.test.ts.
    "get-log-entries": () => ({
      supported: true,
      hostname,
      entries: [
        { timestamp: Date.now(), url: `https://${hostname}/track.js`, method: "GET", type: "script", ruleId: 100, rulesetId: "ads" },
      ],
      heuristics: [
        { id: "fingerprint", on: true, appliesHere: true, fired: { count: 2, lastFiredAt: Date.now() } },
        { id: "cookieBannerReject", on: true, appliesHere: true, fired: null },
        { id: "grayscaleAds", on: true, appliesHere: false, fired: null },
        { id: "feedAdRemoval", on: false, appliesHere: true, fired: null },
        { id: "searchSlop", on: false, appliesHere: false, fired: null },
        { id: "leakedPasswordCheck", on: true, appliesHere: true, fired: null },
        { id: "cnameUncloak", on: true, appliesHere: true, fired: { count: 1, lastFiredAt: Date.now() } },
      ],
    }),
    // Same idea as import-custom-rules below: the options page's own writes
    // land on the shared settings object, so a later render sees them.
    "set-settings-patch": (msg) => {
      Object.assign(settings, msg.patch as Partial<Settings>);
      return undefined;
    },
    // Mutates the same `settings` object storageLocalData.settings already
    // points at, mirroring background/settings.ts's importCustomRules
    // closely enough for a render test to see the real effect on a later
    // getEffectiveSettings()/export-settings call -- see
    // options.render.test.ts's "Migration import" tests.
    "import-custom-rules": (msg) => {
      const blockedDomains = (msg.blockedDomains as string[]) ?? [];
      const allowedDomains = (msg.allowedDomains as string[]) ?? [];
      const cosmeticRules = (msg.cosmeticRules as Record<string, string[]>) ?? {};

      const blockedSet = new Set(settings.customBlockedDomains);
      let addedBlockedDomains = 0;
      for (const domain of blockedDomains) {
        if (blockedSet.has(domain)) continue;
        blockedSet.add(domain);
        addedBlockedDomains++;
      }
      settings.customBlockedDomains = [...blockedSet];

      const allowedSet = new Set(settings.customAllowedDomains);
      let addedAllowedDomains = 0;
      for (const domain of allowedDomains) {
        if (allowedSet.has(domain)) continue;
        allowedSet.add(domain);
        addedAllowedDomains++;
      }
      settings.customAllowedDomains = [...allowedSet];

      let addedCosmeticRules = 0;
      for (const [host, selectors] of Object.entries(cosmeticRules)) {
        const existing = new Set(settings.customCosmeticRules[host] ?? []);
        for (const selector of selectors) {
          if (existing.has(selector)) continue;
          existing.add(selector);
          addedCosmeticRules++;
        }
        settings.customCosmeticRules = { ...settings.customCosmeticRules, [host]: [...existing] };
      }

      return { addedBlockedDomains, addedAllowedDomains, addedCosmeticRules };
    },
  };

  const browser = {
    runtime: {
      id: "mock-extension-id",
      getManifest: () => ({ version: "0.0.0-test" }),
      getURL: (path: string) => path,
      sendMessage: (msg: Record<string, unknown>) => Promise.resolve(sendMessageHandlers[msg.type as string]?.(msg)),
      onMessage: { addListener() {}, removeListener() {} },
      onInstalled: { addListener() {} },
      openOptionsPage: () => {},
    },
    storage: {
      local: {
        get: (keys: unknown) => {
          const result: Record<string, unknown> = {};
          if (typeof keys === "string") result[keys] = storageLocalData[keys];
          else if (Array.isArray(keys)) for (const k of keys) result[k] = storageLocalData[k];
          else if (keys && typeof keys === "object") for (const k of Object.keys(keys)) result[k] = storageLocalData[k];
          else Object.assign(result, storageLocalData);
          return Promise.resolve(result);
        },
        set: (items: Record<string, unknown>) => {
          Object.assign(storageLocalData, items);
          return Promise.resolve();
        },
      },
      sync: { get: callbackOrPromise({}), set: callbackOrPromise(undefined) },
      session: { get: callbackOrPromise({}), set: callbackOrPromise(undefined) },
      managed: { get: callbackOrPromise({}) },
      onChanged: { addListener() {} },
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1, url: `https://${hostname}/`, active: true }]),
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} },
      get: callbackOrPromise(undefined),
      clear: callbackOrPromise(true),
    },
    privacy: {
      network: { webRTCIPHandlingPolicy: { set: callbackOrPromise(undefined), get: callbackOrPromise({ value: "default" }) } },
      websites: { thirdPartyCookiesAllowed: { set: callbackOrPromise(undefined), get: callbackOrPromise({ value: true }) } },
    },
    permissions: { contains: callbackOrPromise(false), request: callbackOrPromise(false) },
    declarativeNetRequest: {
      updateDynamicRules: callbackOrPromise(undefined),
      getDynamicRules: callbackOrPromise([]),
      updateEnabledRulesets: callbackOrPromise(undefined),
      getEnabledRulesets: callbackOrPromise([]),
      getMatchedRules: callbackOrPromise({ rulesMatchedInfo: [] }),
    },
    scripting: {
      registerContentScripts: callbackOrPromise(undefined),
      unregisterContentScripts: callbackOrPromise(undefined),
      getRegisteredContentScripts: callbackOrPromise([]),
    },
    contentSettings: {},
    webNavigation: {
      onCommitted: { addListener() {} },
      onBeforeNavigate: { addListener() {} },
      onCompleted: { addListener() {} },
      onCreatedNavigationTarget: { addListener() {} },
    },
    // Deliberately always "", forcing every getMessageOrFallback() call onto
    // its fallback string -- this is what actually caught the v0.11.89 raw-
    // settings-key-name bug, and is a stricter check than a real install
    // (which has real _locales strings) would ever exercise.
    i18n: { getMessage: () => "", getUILanguage: () => "en" },
  };

  return { browser, storageLocalData };
}

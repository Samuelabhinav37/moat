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
    i18n: { getMessage: () => "" },
  };

  return { browser, storageLocalData };
}

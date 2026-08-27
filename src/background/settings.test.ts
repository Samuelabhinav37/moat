import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

vi.mock("webextension-polyfill", () => {
  const store: Record<string, unknown> = {};
  const syncStore: Record<string, unknown> = {};
  const sessionStore: Record<string, unknown> = {};
  return {
    default: {
      runtime: { getURL: (path: string) => `test://${path}` },
      storage: {
        local: {
          get: (key: string) => Promise.resolve(key in store ? { [key]: store[key] } : {}),
          set: (items: Record<string, unknown>) => {
            Object.assign(store, items);
            return Promise.resolve();
          },
          clear: () => {
            for (const key of Object.keys(store)) delete store[key];
            return Promise.resolve();
          },
        },
        sync: {
          get: (key: string) => Promise.resolve(key in syncStore ? { [key]: syncStore[key] } : {}),
          set: (items: Record<string, unknown>) => {
            Object.assign(syncStore, items);
            return Promise.resolve();
          },
          clear: () => {
            for (const key of Object.keys(syncStore)) delete syncStore[key];
            return Promise.resolve();
          },
        },
        session: {
          get: (key: string) => Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
          set: (items: Record<string, unknown>) => {
            Object.assign(sessionStore, items);
            return Promise.resolve();
          },
          remove: (key: string) => {
            delete sessionStore[key];
            return Promise.resolve();
          },
          clear: () => {
            for (const key of Object.keys(sessionStore)) delete sessionStore[key];
            return Promise.resolve();
          },
        },
        // No managed policy in these tests -- that's covered in managedPolicyMerge.test.ts.
        managed: { get: () => Promise.resolve({}) },
      },
      // Just enough to keep setSettings' internal apply*() calls from
      // throwing -- their actual behavior is covered in their own test
      // files (privacySettings.test.ts, filterGroupState.test.ts,
      // customRules.test.ts).
      privacy: {
        network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } },
        websites: { thirdPartyCookiesAllowed: { set: () => Promise.resolve() } },
      },
      declarativeNetRequest: {
        updateEnabledRulesets: () => Promise.resolve(),
        updateDynamicRules: () => Promise.resolve(),
      },
    },
  };
});

// filterGroups.ts fetches rules/manifest.json directly via the global fetch,
// not through the browser.* mock above -- stub it to an empty catalog so
// setSettings() doesn't attempt a real network request.
vi.stubGlobal("fetch", () => Promise.resolve({ json: () => Promise.resolve([]) }));

const {
  getSettings,
  setSettings,
  isSiteDisabled,
  setSiteDisabled,
  getOrCreateFingerprintSeed,
  getOrCreateSessionFingerprintSeed,
  addCustomCosmeticRule,
  removeCustomCosmeticRule,
  addGrayscaleRule,
  removeGrayscaleRule,
  seedFromSyncIfEmpty,
  applyFreshInstallDefaults,
} = await import("./settings");
const { PRESETS } = await import("../shared/filterPresets");

beforeEach(async () => {
  await (browser.storage.local as unknown as { clear(): Promise<void> }).clear();
  await (browser.storage.sync as unknown as { clear(): Promise<void> }).clear();
  await (browser.storage.session as unknown as { clear(): Promise<void> }).clear();
});

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await getSettings()).toEqual({
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
    });
  });

  it("merges stored values over defaults, not replacing wholesale", async () => {
    await setSettings({ enabled: false });
    const settings = await getSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.disabledSites).toEqual([]); // untouched field still defaulted
  });
});

describe("setSiteDisabled", () => {
  it("adds a hostname to disabledSites", async () => {
    await setSiteDisabled("ads.example.com", true);
    expect((await getSettings()).disabledSites).toEqual(["ads.example.com"]);
  });

  it("is idempotent when adding the same hostname twice", async () => {
    await setSiteDisabled("ads.example.com", true);
    await setSiteDisabled("ads.example.com", true);
    expect((await getSettings()).disabledSites).toEqual(["ads.example.com"]);
  });

  it("removes a hostname when disabled is set back to false", async () => {
    await setSiteDisabled("ads.example.com", true);
    await setSiteDisabled("other.example.com", true);
    await setSiteDisabled("ads.example.com", false);
    expect((await getSettings()).disabledSites).toEqual(["other.example.com"]);
  });
});

describe("getOrCreateFingerprintSeed", () => {
  it("generates and persists a seed the first time it's called", async () => {
    expect((await getSettings()).fingerprintSeed).toBe("");
    const seed = await getOrCreateFingerprintSeed();
    expect(seed).not.toBe("");
    expect((await getSettings()).fingerprintSeed).toBe(seed);
  });

  it("reuses the same seed on subsequent calls instead of regenerating it", async () => {
    const first = await getOrCreateFingerprintSeed();
    const second = await getOrCreateFingerprintSeed();
    expect(second).toBe(first);
  });
});

describe("getOrCreateSessionFingerprintSeed", () => {
  it("generates and persists a seed in storage.session the first time it's called", async () => {
    const seed = await getOrCreateSessionFingerprintSeed();
    expect(seed).not.toBe("");
    const stored = await browser.storage.session.get("sessionFingerprintSeed");
    expect(stored.sessionFingerprintSeed).toBe(seed);
  });

  it("reuses the same seed on subsequent calls instead of regenerating it", async () => {
    const first = await getOrCreateSessionFingerprintSeed();
    const second = await getOrCreateSessionFingerprintSeed();
    expect(second).toBe(first);
  });

  it("is independent of the permanent (storage.local) fingerprint seed", async () => {
    const permanent = await getOrCreateFingerprintSeed();
    const session = await getOrCreateSessionFingerprintSeed();
    expect(session).not.toBe(permanent);
  });
});

describe("addCustomCosmeticRule / removeCustomCosmeticRule", () => {
  it("adds a selector under its hostname", async () => {
    await addCustomCosmeticRule("example.com", ".ad-slot");
    expect((await getSettings()).customCosmeticRules).toEqual({ "example.com": [".ad-slot"] });
  });

  it("is idempotent for the same hostname/selector pair", async () => {
    await addCustomCosmeticRule("example.com", ".ad-slot");
    await addCustomCosmeticRule("example.com", ".ad-slot");
    expect((await getSettings()).customCosmeticRules).toEqual({ "example.com": [".ad-slot"] });
  });

  it("drops the hostname entirely once its last selector is removed", async () => {
    await addCustomCosmeticRule("example.com", ".ad-slot");
    await removeCustomCosmeticRule("example.com", ".ad-slot");
    expect((await getSettings()).customCosmeticRules).toEqual({});
  });

  it("doesn't touch customGrayscaleRules", async () => {
    await addCustomCosmeticRule("example.com", ".ad-slot");
    expect((await getSettings()).customGrayscaleRules).toEqual({});
  });
});

describe("addGrayscaleRule / removeGrayscaleRule", () => {
  it("adds a selector under its hostname, independent of the hide list", async () => {
    await addGrayscaleRule("youtube.com", "#movie_player");
    const settings = await getSettings();
    expect(settings.customGrayscaleRules).toEqual({ "youtube.com": ["#movie_player"] });
    expect(settings.customCosmeticRules).toEqual({});
  });

  it("removes just the given selector, keeping siblings under the same hostname", async () => {
    await addGrayscaleRule("youtube.com", "#movie_player");
    await addGrayscaleRule("youtube.com", ".ad-banner");
    await removeGrayscaleRule("youtube.com", "#movie_player");
    expect((await getSettings()).customGrayscaleRules).toEqual({ "youtube.com": [".ad-banner"] });
  });
});

describe("isSiteDisabled", () => {
  it("is false for a site not in the paused list, with protection enabled", async () => {
    expect(await isSiteDisabled("example.com")).toBe(false);
  });

  it("is true for a site explicitly paused", async () => {
    await setSiteDisabled("example.com", true);
    expect(await isSiteDisabled("example.com")).toBe(true);
  });

  it("is true everywhere once the master switch is off, even for untouched sites", async () => {
    await setSettings({ enabled: false });
    expect(await isSiteDisabled("never-paused.example.com")).toBe(true);
  });
});

describe("storage.sync mirroring", () => {
  it("does not mirror to sync when syncEnabled is off (the default)", async () => {
    await setSettings({ disabledSites: ["example.com"] });
    const synced = await (browser.storage.sync as unknown as { get(key: string): Promise<Record<string, unknown>> }).get(
      "settings"
    );
    expect(synced).toEqual({});
  });

  it("mirrors to sync, excluding fingerprintSeed, once syncEnabled is on", async () => {
    await setSettings({ syncEnabled: true });
    await getOrCreateFingerprintSeed();
    await setSettings({ disabledSites: ["example.com"] });
    const synced = (await (
      browser.storage.sync as unknown as { get(key: string): Promise<Record<string, unknown>> }
    ).get("settings")) as { settings?: Record<string, unknown> };
    expect(synced.settings?.disabledSites).toEqual(["example.com"]);
    expect(synced.settings?.syncEnabled).toBe(true);
    expect(synced.settings).not.toHaveProperty("fingerprintSeed");
  });
});

describe("seedFromSyncIfEmpty", () => {
  it("does nothing when local settings already exist, even if sync has a different value", async () => {
    await setSettings({ disabledSites: ["local.example.com"] });
    await (browser.storage.sync as unknown as { set(items: Record<string, unknown>): Promise<void> }).set({
      settings: { disabledSites: ["synced.example.com"] },
    });
    await seedFromSyncIfEmpty();
    expect((await getSettings()).disabledSites).toEqual(["local.example.com"]);
  });

  it("seeds local settings from sync when local is genuinely empty", async () => {
    await (browser.storage.sync as unknown as { set(items: Record<string, unknown>): Promise<void> }).set({
      settings: { disabledSites: ["synced.example.com"] },
    });
    await seedFromSyncIfEmpty();
    expect((await getSettings()).disabledSites).toEqual(["synced.example.com"]);
  });

  it("is a no-op when both local and sync are empty", async () => {
    await seedFromSyncIfEmpty();
    expect((await getSettings()).disabledSites).toEqual([]);
  });
});

describe("applyFreshInstallDefaults", () => {
  it("seeds the lite preset's filter groups when local is genuinely empty", async () => {
    await applyFreshInstallDefaults();
    expect((await getSettings()).filterGroups).toEqual(PRESETS.lite.filterGroups);
  });

  it("does nothing when local settings already exist (e.g. seedFromSyncIfEmpty already ran)", async () => {
    await setSettings({ disabledSites: ["already-here.example.com"] });
    await applyFreshInstallDefaults();
    const settings = await getSettings();
    expect(settings.filterGroups).toEqual({});
    expect(settings.disabledSites).toEqual(["already-here.example.com"]);
  });

  it("respects settings seeded from sync, even though sync's own filterGroups is {}", async () => {
    await (browser.storage.sync as unknown as { set(items: Record<string, unknown>): Promise<void> }).set({
      settings: { disabledSites: ["synced.example.com"] }, // filterGroups absent -> defaults to {}
    });
    await seedFromSyncIfEmpty();
    await applyFreshInstallDefaults();
    const settings = await getSettings();
    expect(settings.disabledSites).toEqual(["synced.example.com"]);
    expect(settings.filterGroups).toEqual({}); // sync's value wins, not the lite defaults
  });
});

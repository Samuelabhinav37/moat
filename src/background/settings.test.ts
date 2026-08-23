import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

vi.mock("webextension-polyfill", () => {
  const store: Record<string, unknown> = {};
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

const { getSettings, setSettings, isSiteDisabled, setSiteDisabled, getOrCreateFingerprintSeed } = await import(
  "./settings"
);

beforeEach(async () => {
  await (browser.storage.local as unknown as { clear(): Promise<void> }).clear();
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
      filterGroups: {},
      customBlockedDomains: [],
      customAllowedDomains: [],
      customCosmeticRules: {},
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

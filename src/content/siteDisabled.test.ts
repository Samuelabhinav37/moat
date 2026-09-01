import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "../types";

const localGet = vi.fn();
const managedGet = vi.fn();
const onChangedListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: { get: (...args: unknown[]) => localGet(...args) },
      managed: { get: (...args: unknown[]) => managedGet(...args) },
      onChanged: {
        addListener: (fn: (changes: Record<string, unknown>, area: string) => void) => {
          onChangedListeners.push(fn);
        },
      },
    },
  },
}));

// Two separate module instances so this test can exercise cross-script
// sharing the same way two independently-bundled content scripts would,
// without actually needing two Rollup builds -- both import paths resolve
// to the same globalThis-backed cache by design.
async function importFresh() {
  vi.resetModules();
  return import("./siteDisabled");
}

describe("getEffectiveSettingsHere caching", () => {
  beforeEach(() => {
    localGet.mockReset().mockResolvedValue({});
    managedGet.mockReset().mockResolvedValue({});
    onChangedListeners.length = 0;
    // Simulates a fresh page load: no leftover cache from a previous test.
    delete (globalThis as Record<string, unknown>).__moatEffectiveSettingsCache;
    delete (globalThis as Record<string, unknown>).__moatEffectiveSettingsCacheListenerInstalled;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__moatEffectiveSettingsCache;
    delete (globalThis as Record<string, unknown>).__moatEffectiveSettingsCacheListenerInstalled;
  });

  it("only fetches once across repeated calls within one module", async () => {
    const { getEffectiveSettingsHere } = await importFresh();
    await getEffectiveSettingsHere();
    await getEffectiveSettingsHere();
    await getEffectiveSettingsHere();
    expect(localGet).toHaveBeenCalledTimes(1);
    expect(managedGet).toHaveBeenCalledTimes(1);
  });

  it("shares the cache across two separately-imported module instances (simulating two content scripts)", async () => {
    const scriptA = await importFresh();
    // Re-importing without resetModules gives a *different* module registry
    // entry only if the cache key weren't on globalThis -- this simulates
    // two independent IIFE bundles both pointing at the same shared realm.
    vi.resetModules();
    const scriptB = await import("./siteDisabled");

    await scriptA.getEffectiveSettingsHere();
    await scriptB.getEffectiveSettingsHere();

    expect(localGet).toHaveBeenCalledTimes(1);
    expect(managedGet).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after a relevant local storage change", async () => {
    const { getEffectiveSettingsHere } = await importFresh();
    await getEffectiveSettingsHere();
    expect(localGet).toHaveBeenCalledTimes(1);

    expect(onChangedListeners).toHaveLength(1);
    onChangedListeners[0]!({ [STORAGE_KEY]: { newValue: {} } }, "local");

    await getEffectiveSettingsHere();
    expect(localGet).toHaveBeenCalledTimes(2);
  });

  it("re-fetches after a managed-policy change", async () => {
    const { getEffectiveSettingsHere } = await importFresh();
    await getEffectiveSettingsHere();
    onChangedListeners[0]!({}, "managed");
    await getEffectiveSettingsHere();
    expect(managedGet).toHaveBeenCalledTimes(2);
  });

  it("ignores an unrelated local storage change", async () => {
    const { getEffectiveSettingsHere } = await importFresh();
    await getEffectiveSettingsHere();
    onChangedListeners[0]!({ someOtherKey: { newValue: 1 } }, "local");
    await getEffectiveSettingsHere();
    expect(localGet).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejected fetch", async () => {
    localGet.mockReset().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({});
    const { getEffectiveSettingsHere } = await importFresh();

    await expect(getEffectiveSettingsHere()).rejects.toThrow("boom");
    await expect(getEffectiveSettingsHere()).resolves.toMatchObject(DEFAULT_SETTINGS);
    expect(localGet).toHaveBeenCalledTimes(2);
  });

  it("installs the invalidation listener only once even across module instances", async () => {
    const scriptA = await importFresh();
    vi.resetModules();
    const scriptB = await import("./siteDisabled");

    await scriptA.getEffectiveSettingsHere();
    await scriptB.getEffectiveSettingsHere();

    expect(onChangedListeners).toHaveLength(1);
  });
});

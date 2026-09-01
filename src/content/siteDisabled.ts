// Shared by every isolated-world content script that needs to know whether
// protection is paused here, and/or its own feature flag: cosmeticFilter.ts,
// consentRejector.ts, leakedPasswordCheck.ts, feedAdScanner.ts, and
// youtubeAdDimmer.ts (bridge.ts uses background/settings.ts's own
// getEffectiveSettings instead -- it needs fields, like the fingerprint
// seed, that this deliberately-narrower module doesn't carry).
//
// Deliberately imports only managedPolicy.ts, not the full background/
// settings.ts -- that module also pulls in filterGroups/customRules/
// privacySettings application logic that content scripts have no use for
// and shouldn't carry into their bundle.
import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from "../types";
import { getManagedPolicy, applyManagedOverrides } from "../background/managedPolicy";

// Every script above is built as its own fully self-contained Rollup IIFE
// (see scripts/build.mjs) -- each gets its OWN private copy of this file's
// source inlined into its bundle, so a plain module-level cache variable
// here would only dedupe repeat calls *within* one script (none of them
// currently make more than one), not the up-to-5x redundant
// storage.local.get + storage.managed.get across the different scripts that
// all run in the same page load. What they DO genuinely share is the JS
// global object itself -- Chrome's "isolated world" is one realm per
// extension per frame -- so the cache lives on globalThis instead, under a
// namespaced key.
//
// Several of these scripts deliberately react live to a settings change
// while the page is still open (see e.g. feedAdScanner.ts's own
// storage.onChanged listener, which re-checks whether it should keep
// running, specifically so toggling a setting doesn't need a reload) -- so
// this cannot just be cached forever for the page's lifetime. It's
// invalidated on the same event instead, via one shared listener installed
// once regardless of how many of the scripts above end up running on a
// given page.
const CACHE_KEY = "__moatEffectiveSettingsCache";
const LISTENER_KEY = "__moatEffectiveSettingsCacheListenerInstalled";

interface CacheHost {
  [CACHE_KEY]?: Promise<Settings>;
  [LISTENER_KEY]?: boolean;
}

function cacheHost(): CacheHost {
  return globalThis as unknown as CacheHost;
}

function ensureInvalidationListener(): void {
  const host = cacheHost();
  if (host[LISTENER_KEY]) return;
  host[LISTENER_KEY] = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "managed" || (area === "local" && STORAGE_KEY in changes)) {
      delete host[CACHE_KEY];
    }
  });
}

async function fetchEffectiveSettings(): Promise<Settings> {
  const [stored, policy] = await Promise.all([browser.storage.local.get(STORAGE_KEY), getManagedPolicy()]);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) };
  return applyManagedOverrides(settings, policy);
}

/** Single storage.local read (+ managed-policy merge) for every check every
 * content script on this page needs -- the disabled-here check and any of
 * its own feature flags -- cached across all of them for this page load
 * (see the module comment above) and invalidated the moment settings
 * actually change, not just deduplicated for one caller. */
export async function getEffectiveSettingsHere(): Promise<Settings> {
  const host = cacheHost();
  ensureInvalidationListener();
  if (!host[CACHE_KEY]) {
    host[CACHE_KEY] = fetchEffectiveSettings().catch((err: unknown) => {
      // Don't cache a failure -- a transient storage-API error shouldn't
      // permanently break every content script on this page until an
      // unrelated settings change happens to clear it.
      delete host[CACHE_KEY];
      throw err;
    });
  }
  return host[CACHE_KEY]!;
}

export function isDisabled(effective: Settings): boolean {
  return !effective.enabled || effective.disabledSites.includes(location.hostname);
}

/** Convenience wrapper for callers that only need the boolean and have no
 * other use for the rest of the settings object. */
export async function isDisabledHere(): Promise<boolean> {
  return isDisabled(await getEffectiveSettingsHere());
}

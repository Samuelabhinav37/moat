// Content scripts for opt-in, off-by-default features are registered here at
// runtime via chrome.scripting instead of statically in scripts/manifest.ts,
// so their bundles are not parsed and executed on every page load for the
// (default) user who has never turned the feature on.
//
// - consent-rejector.js       ~18 KB, <all_urls>, cookieBannerAutoReject (off by default)
// - leaked-password-check.js  ~13 KB, <all_urls>, leakedPasswordCheck (off by default)
//
// element-picker.js is handled separately (popup.ts injects it with
// scripting.executeScript on click -- it has no setting, it's a one-shot
// manual action). youtube-ad-dimmer.js / feed-ad-scanner.js stay static:
// they're already scoped to YouTube / IG+LI, so they carry ~no <all_urls>
// cost, and grayscaleUnblockableAds is on by default anyway.
//
// Each script also keeps its own isEnabled() guard -- registration is the
// optimisation, the guard is the correctness boundary.
import browser from "webextension-polyfill";
import type { Settings } from "../types";

export interface OptionalScript {
  id: string;
  js: string;
  matches: string[];
  runAt: "document_start" | "document_end" | "document_idle";
  /** Whether this script should be registered for the given settings. */
  wants: (settings: Settings) => boolean;
}

export const OPTIONAL_SCRIPTS: OptionalScript[] = [
  {
    id: "moat-consent-rejector",
    js: "consent-rejector.js",
    matches: ["<all_urls>"],
    runAt: "document_idle",
    wants: (s) => s.cookieBannerAutoReject,
  },
  {
    id: "moat-leaked-password-check",
    js: "leaked-password-check.js",
    matches: ["<all_urls>"],
    runAt: "document_idle",
    wants: (s) => s.leakedPasswordCheck,
  },
];

/** Pure: given the desired settings and the ids currently registered, what
 * to add and what to remove. Split out so it's testable without the
 * scripting API. */
export function planReconcile(
  settings: Settings,
  registeredIds: Iterable<string>
): { register: OptionalScript[]; unregisterIds: string[] } {
  const registered = new Set(registeredIds);
  const register: OptionalScript[] = [];
  const unregisterIds: string[] = [];
  for (const script of OPTIONAL_SCRIPTS) {
    const want = script.wants(settings);
    if (want && !registered.has(script.id)) register.push(script);
    else if (!want && registered.has(script.id)) unregisterIds.push(script.id);
  }
  return { register, unregisterIds };
}

/** Bring the set of dynamically-registered optional content scripts in line
 * with `settings`. Idempotent -- safe to call on every service-worker cold
 * start (via reapplySettings) as well as on every settings change. Swallows
 * its own errors: if the scripting API is unavailable or a call fails, the
 * scripts' own isEnabled() guards still keep behaviour correct. */
export async function reconcileOptionalContentScripts(settings: Settings): Promise<void> {
  const ids = OPTIONAL_SCRIPTS.map((s) => s.id);
  let current: Array<{ id: string }>;
  try {
    current = await browser.scripting.getRegisteredContentScripts({ ids });
  } catch {
    return;
  }

  const { register, unregisterIds } = planReconcile(settings, current.map((s) => s.id));

  if (unregisterIds.length > 0) {
    await browser.scripting.unregisterContentScripts({ ids: unregisterIds }).catch(() => {});
  }
  if (register.length > 0) {
    await browser.scripting
      .registerContentScripts(
        register.map((s) => ({
          id: s.id,
          js: [s.js],
          matches: s.matches,
          runAt: s.runAt,
          allFrames: false,
          // Survive a browser restart so an enabled feature still runs on
          // the first page load after one, without waiting for the worker
          // to wake; reapplySettings reconciles any drift on the next wake.
          persistAcrossSessions: true,
        }))
      )
      .catch(() => {});
  }
}

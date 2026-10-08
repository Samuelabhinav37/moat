// Content scripts for opt-in, off-by-default features are registered here at
// runtime via chrome.scripting instead of statically in scripts/manifest.ts,
// so their bundles are not parsed and executed on every page load for the
// (default) user who has never turned the feature on.
//
// - consent-rejector.js       ~18 KB, <all_urls>, cookieBannerAutoReject (on by default since 0.11.136)
// - leaked-password-check.js  ~13 KB, <all_urls>, leakedPasswordCheck (off by default)
// - early-cosmetics.css and early-cosmetics-excepted.css, whenever Moat is
//   on, paused sites left out (and, for the second, the sites that make an
//   exception for one of its selectors). Generic hiding the browser applies
//   at document start by itself, so ads don't flash while the worker wakes
//   (scripts/lib/earlyCosmetics.mjs).
// - admiral-guard.js          <1 KB, MAIN world, whenever Moat is on. Registered
//   here rather than in the manifest so paused sites can be left out before
//   the page's first script runs (a static script only learns about a pause
//   after the page's inline scripts already ran).
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
  /** A script, or a stylesheet (`css`). */
  js?: string;
  css?: string;
  matches: string[];
  runAt: "document_start" | "document_end" | "document_idle";
  /** The page's own JavaScript world instead of the extension's isolated one. */
  world?: "MAIN";
  /** Whether this script should be registered for the given settings. */
  wants: (settings: Settings, data: ReconcileData) => boolean;
  /** Pages to leave out, e.g. the sites Moat is paused on. */
  excludeMatches?: (settings: Settings, data: ReconcileData) => string[];
}

/** Bundled data some registrations need, loaded once per reconcile. */
export interface ReconcileData {
  /** Plain domains that make an exception for a selector in
   * early-cosmetics-excepted.css (scripts/lib/earlyCosmetics.mjs), or null
   * if the list couldn't be read. */
  earlyExceptionDomains: string[] | null;
}

const NO_DATA: ReconcileData = { earlyExceptionDomains: null };

async function loadReconcileData(): Promise<ReconcileData> {
  try {
    const list = (await (await fetch(browser.runtime.getURL("rules/early-cosmetics-exclude.json"))).json()) as unknown;
    return { earlyExceptionDomains: Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : null };
  } catch {
    return NO_DATA;
  }
}

/** A domain and its subdomains as a match pattern, or null if it can't be one. */
function domainPattern(site: string): string | null {
  const host = site.trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) return null;
  return /^[0-9.]+$/.test(host) ? `*://${host}/*` : `*://*.${host}/*`;
}

/** Match patterns for the paused sites and their subdomains. Anything that
 * can't be a valid pattern is skipped: one bad pattern fails the whole
 * registration. */
export function pausedSitePatterns(settings: Settings): string[] {
  return settings.disabledSites.map(domainPattern).filter((p): p is string => p !== null).sort();
}

/** Paused sites plus every site that makes an exception for one of the
 * selectors in early-cosmetics-excepted.css. */
function earlyExceptedPatterns(settings: Settings, data: ReconcileData): string[] {
  const patterns = new Set(pausedSitePatterns(settings));
  for (const domain of data.earlyExceptionDomains ?? []) {
    const pattern = domainPattern(domain);
    if (pattern) patterns.add(pattern);
  }
  return [...patterns].sort();
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
  {
    id: "moat-early-cosmetics",
    css: "early-cosmetics.css",
    matches: ["<all_urls>"],
    runAt: "document_start",
    wants: (s) => s.enabled,
    excludeMatches: pausedSitePatterns,
  },
  {
    id: "moat-early-cosmetics-excepted",
    css: "early-cosmetics-excepted.css",
    matches: ["<all_urls>"],
    runAt: "document_start",
    // Never without its list of sites to leave out: it would hide on a site
    // that made an exception, for the page's whole life.
    wants: (s, d) => s.enabled && d.earlyExceptionDomains !== null,
    excludeMatches: earlyExceptedPatterns,
  },
  {
    id: "moat-admiral-guard",
    js: "admiral-guard.js",
    matches: ["<all_urls>"],
    runAt: "document_start",
    world: "MAIN",
    wants: (s) => s.enabled,
    excludeMatches: pausedSitePatterns,
  },
];

/** What's registered now, as getRegisteredContentScripts reports it. */
export interface RegisteredScript {
  id: string;
  excludeMatches?: string[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((value, i) => value === sortedB[i]);
}

/** Pure: given the desired settings and the ids currently registered, what
 * to add and what to remove. Split out so it's testable without the
 * scripting API. */
export function planReconcile(
  settings: Settings,
  registeredScripts: Iterable<string | RegisteredScript>,
  data: ReconcileData = NO_DATA
): { register: OptionalScript[]; unregisterIds: string[] } {
  const registered = new Map(
    [...registeredScripts].map((s) => (typeof s === "string" ? [s, { id: s }] : [s.id, s]) as [string, RegisteredScript])
  );
  const register: OptionalScript[] = [];
  const unregisterIds: string[] = [];
  for (const script of OPTIONAL_SCRIPTS) {
    const want = script.wants(settings, data);
    const current = registered.get(script.id);
    if (want && !current) register.push(script);
    else if (!want && current) unregisterIds.push(script.id);
    else if (want && current && script.excludeMatches) {
      // Registered, but for an older list of paused sites: replace it.
      if (!sameList(script.excludeMatches(settings, data), current.excludeMatches ?? [])) {
        unregisterIds.push(script.id);
        register.push(script);
      }
    }
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
  let current: RegisteredScript[];
  try {
    current = await browser.scripting.getRegisteredContentScripts({ ids });
  } catch {
    return;
  }

  const data = await loadReconcileData();
  const { register, unregisterIds } = planReconcile(settings, current, data);

  if (unregisterIds.length > 0) {
    await browser.scripting.unregisterContentScripts({ ids: unregisterIds }).catch(() => {});
  }
  // One call per script, so one the browser rejects can't take the others
  // down with it.
  for (const s of register) {
    const excludeMatches = s.excludeMatches?.(settings, data) ?? [];
    await browser.scripting
      .registerContentScripts([
        {
          id: s.id,
          ...(s.js ? { js: [s.js] } : {}),
          ...(s.css ? { css: [s.css] } : {}),
          matches: s.matches,
          ...(excludeMatches.length > 0 ? { excludeMatches } : {}),
          runAt: s.runAt,
          ...(s.world ? { world: s.world } : {}),
          allFrames: false,
          // Survive a browser restart so an enabled feature still runs on
          // the first page load after one, without waiting for the worker
          // to wake; reapplySettings reconciles any drift on the next wake.
          persistAcrossSessions: true,
        },
      ])
      .catch(() => {});
  }
}

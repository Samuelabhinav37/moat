// Generic cosmetic selectors already resolved for a site, so the next page
// load there can hide them in the commit-time stylesheet instead of waiting
// for the page's surveyor to ask again. Without this, a fast (cached) page or
// the first page after the worker restarts painted a reserved ad slot for
// 5-10 frames before the surveyor's round trip landed
// (docs/research/test-audit-2026-09.md, finding 4.4).
//
// Kept in storage.session, not storage.local: it's in memory and gone when
// the browser closes, so it never becomes an on-disk list of sites visited.
// That still covers both cases measured: repeat visits and worker restarts
// within a session.
import browser from "webextension-polyfill";

export const MAX_SITES = 500;
export const MAX_SELECTORS_PER_SITE = 300;
const STORAGE_KEY = "genericSelectorCache";

export interface CacheState {
  /** Moat version the selectors came from; a different version starts over. */
  version: string;
  /** hostname -> selectors, least recently used first (Map insertion order). */
  sites: Map<string, string[]>;
}

/** Adds newly resolved selectors for a site, most recently used last. */
export function remember(state: CacheState, hostname: string, selectors: readonly string[]): void {
  if (selectors.length === 0) return;
  const merged = [...new Set([...(state.sites.get(hostname) ?? []), ...selectors])].slice(0, MAX_SELECTORS_PER_SITE);
  state.sites.delete(hostname);
  state.sites.set(hostname, merged);
  while (state.sites.size > MAX_SITES) state.sites.delete(state.sites.keys().next().value!);
}

export function recall(state: CacheState, hostname: string): string[] {
  return state.sites.get(hostname) ?? [];
}

let loaded: Promise<CacheState> | null = null;

function currentVersion(): string {
  return browser.runtime.getManifest().version;
}

function load(): Promise<CacheState> {
  loaded ??= (async () => {
    const version = currentVersion();
    try {
      const stored = (await browser.storage.session.get(STORAGE_KEY))[STORAGE_KEY] as
        | { version: string; sites: [string, string[]][] }
        | undefined;
      if (stored?.version === version && Array.isArray(stored.sites)) return { version, sites: new Map(stored.sites) };
    } catch {
      // storage.session unavailable: run with an empty in-memory cache.
    }
    return { version, sites: new Map() };
  })();
  return loaded;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(state: CacheState): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void browser.storage.session.set({ [STORAGE_KEY]: { version: state.version, sites: [...state.sites] } }).catch(() => {});
  }, 1000);
}

export async function rememberGenericSelectors(hostname: string, selectors: readonly string[]): Promise<void> {
  if (!hostname || selectors.length === 0) return;
  const state = await load();
  remember(state, hostname, selectors);
  scheduleSave(state);
}

export async function cachedGenericSelectors(hostname: string): Promise<string[]> {
  if (!hostname) return [];
  return recall(await load(), hostname);
}

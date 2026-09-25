// What CNAME uncloaking (cnameUncloak.ts on Firefox, cnameUncloakChrome.ts on
// Chrome) checks a disguised subdomain's real address against, plus the
// settings both paths gate on. Shared so the two can't drift apart.
//
// A disguised address is blocked when it's a known CNAME-cloak destination
// (rules/cname-cloak-destinations.json, AdGuard's list) OR a domain Moat's own
// tracker/ad lists already block (rules/uncloak-domains.json) -- the second
// half is how uBlock Origin does it: re-apply your normal filters to the
// uncloaked name. Only the lists you have on count, so turning Trackers off
// in Settings turns it off here too.
import browser from "webextension-polyfill";
import type { Settings } from "../types";
import { effectiveFilterGroupState } from "./filterGroupState";
import { matchesDomainOrSubdomain } from "../shared/domainChain";

export const UNCLOAK_GROUPS = ["trackers", "ads"] as const;
export type UncloakDomains = Partial<Record<(typeof UNCLOAK_GROUPS)[number], string[]>>;

/** Pure: the destination set for one combination of lists. */
export function buildDestinationSet(cnameList: string[], byGroup: UncloakDomains, groupsOn: readonly string[]): Set<string> {
  const set = new Set(cnameList);
  for (const group of UNCLOAK_GROUPS) {
    if (!groupsOn.includes(group)) continue;
    for (const domain of byGroup[group] ?? []) set.add(domain);
  }
  return set;
}

/** Pure: which of the uncloak groups these settings have on. */
export function uncloakGroupsOn(settings: Pick<Settings, "enabled" | "filterGroups">): string[] {
  const state = effectiveFilterGroupState(settings.enabled, settings.filterGroups, [...UNCLOAK_GROUPS]);
  return UNCLOAK_GROUPS.filter((group) => state[group]);
}

let currentSettings: Settings | null = null;

/** Called by both paths' apply functions on every settings change. */
export function setUncloakSettings(settings: Settings): void {
  currentSettings = settings;
}

/** Paused sites get nothing from Moat, uncloaking included. On Chrome this
 * also keeps a paused site's hostnames away from the DoH resolver. */
export function isPagePaused(pageHostname: string): boolean {
  if (!currentSettings) return false;
  return matchesDomainOrSubdomain(pageHostname, currentSettings.disabledSites);
}

let cached: { key: string; set: Set<string> } | null = null;
// One in-flight build at a time, so a burst of requests right after the
// setting is turned on doesn't parse the 3.7 MB file once per request.
let building: { key: string; promise: Promise<Set<string>> } | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  return (await (await fetch(browser.runtime.getURL(path))).json()) as T;
}

export function loadCloakDestinations(): Promise<Set<string>> {
  const groupsOn = currentSettings ? uncloakGroupsOn(currentSettings) : [...UNCLOAK_GROUPS];
  const key = groupsOn.join(",");
  if (cached?.key === key) return Promise.resolve(cached.set);
  if (building?.key === key) return building.promise;

  const promise = (async () => {
    const [cnameList, byGroup] = await Promise.all([
      fetchJson<string[]>("rules/cname-cloak-destinations.json"),
      // Skip the big file entirely when neither list is on.
      groupsOn.length > 0 ? fetchJson<UncloakDomains>("rules/uncloak-domains.json") : Promise.resolve({}),
    ]);
    const set = buildDestinationSet(cnameList, byGroup, groupsOn);
    cached = { key, set };
    return set;
  })();
  building = { key, promise };
  void promise.finally(() => {
    if (building?.promise === promise) building = null;
  });
  return promise;
}

/** Test-only: forget cached state between tests. */
export function resetCnameDestinationsForTest(): void {
  cached = null;
  building = null;
  currentSettings = null;
}

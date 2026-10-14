// Who a blocked request belonged to and what it was for, from its own
// domain (rules/tracker-domains.json, built from Ghostery's TrackerDB by
// scripts/lib/trackerDomains.mjs). Pure: the worker loads the table and
// passes it in, so this is testable without a browser.
import { domainChain } from "./domainChain";
import { siteOf } from "./siteOf";

export interface TrackerTable {
  /** Company names. */
  o: string[];
  /** TrackerDB categories ("advertising", "site_analytics", ...). */
  c: string[];
  /** domain -> [company index, category index]. */
  d: Record<string, [number, number]>;
}

export interface TrackerInfo {
  company: string;
  category: string;
}

export function lookupTracker(table: TrackerTable | null, hostname: string): TrackerInfo | null {
  if (!table || !hostname) return null;
  for (const domain of domainChain(hostname.toLowerCase())) {
    const hit = table.d[domain];
    if (hit) return { company: table.o[hit[0]] ?? "", category: table.c[hit[1]] ?? "misc" };
  }
  return null;
}

/** Advertising (and adult advertising) counts as an ad; every other
 * TrackerDB purpose (analytics, social, customer chat, fingerprinting,
 * session replay hosts...) watches the visitor, so it counts as a tracker. */
export function isAdCategory(category: string): boolean {
  return category === "advertising" || category === "pornvertising";
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export interface DomainTally {
  /** Blocked requests whose domain TrackerDB calls a tracker. */
  trackers: number;
  /** ... and an ad server. */
  ads: number;
  companies: Record<string, number>;
  /** TrackerDB category -> blocked requests. */
  purposes: Record<string, number>;
}

/** The purpose a site's own blocked requests count under: its analytics,
 * whatever TrackerDB files the host as (ChatGPT's own telemetry showed as
 * "utilities", field report 2026-10-14). */
export const OWN_SITE_PURPOSE = "site_analytics";

/** Sorts a page's blocked request hosts (host -> count) by company and
 * purpose. With the page's host, a request to the page's own site counts as
 * that site's analytics. */
export function tallyHosts(table: TrackerTable | null, hosts: ReadonlyMap<string, number>, pageHost?: string): DomainTally {
  const tally: DomainTally = { trackers: 0, ads: 0, companies: {}, purposes: {} };
  const pageSite = pageHost ? siteOf(pageHost) : null;
  for (const [host, count] of hosts) {
    const known = lookupTracker(table, host);
    const ownSite = pageSite !== null && siteOf(host) === pageSite;
    const info = ownSite ? { company: known?.company ?? "", category: OWN_SITE_PURPOSE } : known;
    if (!info) continue;
    if (isAdCategory(info.category)) tally.ads += count;
    else tally.trackers += count;
    if (info.company) tally.companies[info.company] = (tally.companies[info.company] ?? 0) + count;
    tally.purposes[info.category] = (tally.purposes[info.category] ?? 0) + count;
  }
  return tally;
}

export interface Kinds {
  ads: number;
  trackers: number;
  popups: number;
}

/** The page's ads/trackers/pop-ups split, with every block in it.
 * Trackers: the larger of what the domains say (no quota) and what the
 * matched rules said. Pop-ups: the pop-up rules. Ads: the rest, so the three
 * always add up to the total and nothing is left "not sorted". */
export function splitKinds(total: number, ruleBased: Kinds, domains: Pick<DomainTally, "trackers">): Kinds {
  // Matched rules count every retry of a blocked request; the total counts
  // each address once. Scale them to the total so the split keeps their shares.
  const ruleSum = ruleBased.ads + ruleBased.trackers + ruleBased.popups;
  if (ruleSum > total && ruleSum > 0) {
    const scale = total / ruleSum;
    ruleBased = { ads: ruleBased.ads * scale, trackers: Math.round(ruleBased.trackers * scale), popups: Math.round(ruleBased.popups * scale) };
  }
  const popups = Math.min(ruleBased.popups, total);
  const trackers = Math.min(Math.max(domains.trackers, ruleBased.trackers), Math.max(0, total - popups));
  return { ads: Math.max(0, total - popups - trackers), trackers, popups };
}

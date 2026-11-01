// Signed per-site exceptions (live/site-exceptions.json), DuckDuckGo's
// privacy-configuration idea: when enough people report a site broken
// (report-worker labels it), a person adds an entry here, linked to its
// report issue, and every install picks it up within a day. Two kinds:
//   - off: per-site defaults for the overridable features, at the same layer
//     as the built-in login-site defaults (knownLoginDomains.ts). Your own
//     per-site choice for that feature still wins.
//   - allowRequests: lets the site's pages load everything, like a "Never
//     block" entry but below it (QUICK_FIX_PRIORITY). The danger lists sit
//     far above and still block.
// Shared by the background and content scripts. No webextension-polyfill import.
import { domainChain } from "./domainChain";
import { OVERRIDABLE_KEYS } from "./perSiteOverrides";
import type { OverridableSettingKey, Settings } from "../types";

export const SITE_EXCEPTIONS_FORMAT = 1;
export const SITE_EXCEPTIONS_KEY = "liveSiteExceptions";
export const MAX_SITE_EXCEPTIONS = 500;

export interface SiteException {
  site: string;
  off: OverridableSettingKey[];
  allowRequests: boolean;
  /** The moat-reports issue that asked for it. */
  issue: number;
}

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const KEYS = new Set<string>(OVERRIDABLE_KEYS);

function parseEntry(value: unknown): SiteException | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.site !== "string" || e.site.length > 253 || !HOST.test(e.site)) return null;
  if (!Number.isInteger(e.issue) || (e.issue as number) <= 0) return null;
  const off = Array.isArray(e.off) ? e.off : [];
  if (!off.every((key) => typeof key === "string" && KEYS.has(key))) return null;
  const allowRequests = e.allowRequests === true;
  if (off.length === 0 && !allowRequests) return null;
  return { site: e.site, off: off as OverridableSettingKey[], allowRequests, issue: e.issue as number };
}

/** The valid entries, or null when the file isn't a site-exceptions payload.
 * A bad entry is dropped on its own; the rest still apply. */
export function parseSiteExceptions(value: unknown): SiteException[] | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as { format?: unknown; sites?: unknown };
  if (payload.format !== SITE_EXCEPTIONS_FORMAT || !Array.isArray(payload.sites)) return null;
  return payload.sites.map(parseEntry).filter((e): e is SiteException => e !== null).slice(0, MAX_SITE_EXCEPTIONS);
}

/** Settings with the exceptions' feature defaults folded into
 * perSiteOverrides, skipping any feature you set yourself on that site or
 * a parent of it. */
export function applySiteExceptions(settings: Settings, exceptions: readonly SiteException[]): Settings {
  if (exceptions.length === 0) return settings;
  const own = settings.perSiteOverrides;
  const merged: Settings["perSiteOverrides"] = { ...own };
  for (const { site, off } of exceptions) {
    for (const key of off) {
      if (domainChain(site).some((domain) => own[domain]?.[key] !== undefined)) continue;
      merged[site] = { ...merged[site], [key]: false };
    }
  }
  return { ...settings, perSiteOverrides: merged };
}

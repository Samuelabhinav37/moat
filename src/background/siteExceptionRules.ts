// Stores the signed site exceptions (shared/siteExceptions.ts) and turns
// their allowRequests entries into allowAllRequests rules for each site's
// pages, at QUICK_FIX_PRIORITY: above the ad and tracker lists, below your
// own "Never block" and pause, and far below the danger lists, which still
// block. The feature defaults need no rules; settings reads apply them.
import browser from "webextension-polyfill";
import type { DeclarativeNetRequest } from "webextension-polyfill";
import { SITE_EXCEPTIONS_KEY, parseSiteExceptions, type SiteException } from "../shared/siteExceptions";
import { QUICK_FIX_PRIORITY } from "../shared/rulePriorities";

/** One rule holds every site (requestDomains), so one id is enough. */
export const SITE_EXCEPTION_ID_START = 945_000;

/** Pure; exported for tests. */
export function buildSiteExceptionRules(exceptions: readonly SiteException[]): DeclarativeNetRequest.Rule[] {
  const sites = exceptions.filter((e) => e.allowRequests).map((e) => e.site);
  if (sites.length === 0) return [];
  return [
    {
      id: SITE_EXCEPTION_ID_START,
      priority: QUICK_FIX_PRIORITY,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: sites, resourceTypes: ["main_frame", "sub_frame"] },
    },
  ];
}

/** Store a verified payload and apply it. Returns how many entries it holds. */
export async function storeSiteExceptions(value: unknown): Promise<number> {
  const exceptions = parseSiteExceptions(value);
  if (!exceptions) throw new Error("site-exceptions payload was malformed");
  await browser.storage.local.set({ [SITE_EXCEPTIONS_KEY]: exceptions });
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SITE_EXCEPTION_ID_START],
    addRules: buildSiteExceptionRules(exceptions),
  });
  return exceptions.length;
}


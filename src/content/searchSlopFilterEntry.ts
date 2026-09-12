// Isolated-world content script, scoped only to Google/Bing/DuckDuckGo
// search-results pages (see scripts/manifest.ts). Thin wiring layer over the
// pure matching logic in searchSlopFilter.ts -- this file owns the settings
// gate, the curated-domain-list fetch, and run scheduling; it's the one that
// imports "webextension-polyfill", so it's deliberately NOT unit-tested
// directly (same split as adCollapse.ts/cosmeticFilter.ts).
import browser from "webextension-polyfill";
import { engineConfigFor, runSearchSlopPass } from "./searchSlopFilter";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { effectiveValue } from "../shared/perSiteOverrides";
import type { RecordUsageSignalMessage } from "../types";

function reportHidden(count: number): void {
  if (count <= 0) return;
  const message: RecordUsageSignalMessage = {
    type: "record-usage-signal",
    signal: "searchSlop",
    hostname: location.hostname,
    count,
  };
  browser.runtime.sendMessage(message).catch(() => {});
}

async function readSeoSpamDomains(): Promise<string[]> {
  try {
    const list = (await (await fetch(browser.runtime.getURL("rules/seo-spam-domains.json"))).json()) as unknown;
    return Array.isArray(list) ? list.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

async function isEnabled(): Promise<boolean> {
  const effective = await getEffectiveSettingsHere();
  return effectiveValue(effective, location.hostname, "hideSeoSpamResults") && !isDisabled(effective);
}

async function run(): Promise<void> {
  const config = engineConfigFor(location.hostname);
  if (!config) return;
  if (!(await isEnabled())) return;

  const domains = await readSeoSpamDomains();
  if (domains.length === 0) return;

  const pass = (): void => {
    try {
      reportHidden(runSearchSlopPass(document, location.href, config, domains));
    } catch {
      // Best-effort; never let a filtering pass break the page.
    }
  };

  if (document.readyState === "complete") pass();
  else window.addEventListener("load", pass, { once: true });
}

void run();

// Keeps the redirect/popup domain list fresher than the extension's own
// release cadence would otherwise allow. The bulk of blocking (the ~273k
// rules from update-filters.mjs) stays static/build-time -- MV3's dynamic
// rule budget is nowhere near large enough to hold that. This narrow slice
// (currently ~500 known popup/redirect domains) is small enough to live-
// update: once a day, fetch whatever's currently committed to
// live/redirect-domains.json on GitHub and apply it as dynamic
// declarativeNetRequest rules plus feed the tab safety net (popupGuard.ts).
//
// That file only changes when someone runs `npm run filters:update` and
// pushes the result -- there's no scheduled automation writing to the repo
// on its own. This just means a fresher list reaches already-installed
// copies of the extension without waiting on a new store release.
import browser from "webextension-polyfill";
import { addLiveRedirectDomains } from "./popupGuard";
import { allLiveDynamicRuleIds, buildDynamicRedirectRules } from "./liveRedirectRules";

const LIVE_DATA_URL =
  "https://raw.githubusercontent.com/Samuelabhinav37/moat/master/live/redirect-domains.json";
const ALARM_NAME = "moat-live-update";
const PERIOD_MINUTES = 24 * 60;
const STATUS_KEY = "liveUpdateStatus";

export interface LiveUpdateStatus {
  ok: boolean;
  timestamp: number;
  domainCount?: number;
}

export async function getLiveUpdateStatus(): Promise<LiveUpdateStatus | null> {
  const stored = await browser.storage.local.get(STATUS_KEY);
  return (stored[STATUS_KEY] as LiveUpdateStatus | undefined) ?? null;
}

async function setStatus(status: LiveUpdateStatus): Promise<void> {
  await browser.storage.local.set({ [STATUS_KEY]: status });
}

async function refresh(): Promise<void> {
  try {
    const response = await fetch(LIVE_DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const domains = (await response.json()) as string[];

    await addLiveRedirectDomains(domains);
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allLiveDynamicRuleIds(),
      addRules: buildDynamicRedirectRules(domains),
    });

    await setStatus({ ok: true, timestamp: Date.now(), domainCount: domains.length });
  } catch {
    // Offline, GitHub unreachable, rate-limited -- keep the bundled
    // baseline and try again on the next alarm tick.
    await setStatus({ ok: false, timestamp: Date.now() });
  }
}

export function initLiveUpdates(): void {
  void browser.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: PERIOD_MINUTES });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void refresh();
  });
}

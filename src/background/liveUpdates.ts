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
import { allLiveDynamicRuleIds, buildDynamicRedirectRules, filterValidRedirectDomains } from "./liveRedirectRules";
import { allQuickFixRuleIds, buildQuickFixRules, filterValidQuickFixes } from "./quickFixRules";
import { reapplySettings } from "./settings";

const LIVE_DATA_URL =
  "https://raw.githubusercontent.com/Samuelabhinav37/moat/master/live/redirect-domains.json";
// Same repo, same trust model, same daily alarm as the redirect-domain list
// above -- an emergency anti-adblock-circumvention/breakage-fix channel
// reusing the existing pipeline rather than standing up new infrastructure
// (see quickFixRules.ts for the rule shapes this accepts). Empty (`[]`) by
// default; this is the plumbing, not an active patch.
const QUICK_FIXES_URL = "https://raw.githubusercontent.com/Samuelabhinav37/moat/master/live/quick-fixes.json";
const ALARM_NAME = "moat-live-update";
const PERIOD_MINUTES = 24 * 60;
const STATUS_KEY = "liveUpdateStatus";

// A service-worker cold start re-runs initLiveUpdates(), and on some platforms
// the periodic alarm can fire a little early. Without a guard, a browser that
// cycles its worker often would hit the update host several times a day
// instead of ~once. Skip the network work if the last fetch succeeded within
// this window; the periodic alarm still guarantees at least a daily refresh.
export const MIN_REFETCH_INTERVAL_MS = 18 * 60 * 60 * 1000;

// First-ever fetch delay, jittered, so freshly-installed copies don't land on
// the update host in a synchronized burst. (The periodic interval itself
// naturally de-syncs over time; this only spreads the very first fire.)
const INITIAL_DELAY_MIN = 30;
const INITIAL_DELAY_JITTER_MIN = 150;

/** Pure so it's testable without the alarms/storage APIs. */
export function shouldSkipRefetch(
  last: { ok: boolean; timestamp: number } | null,
  now: number,
  minIntervalMs: number = MIN_REFETCH_INTERVAL_MS,
): boolean {
  return last !== null && last.ok && now - last.timestamp < minIntervalMs;
}

interface LiveUpdateStatus {
  ok: boolean;
  timestamp: number;
  domainCount?: number;
  // Omitted entirely when there are no active quick fixes -- the common
  // case -- rather than shown as "0 quick fixes" every time, keeping the
  // status line quiet unless there's actually something to say.
  quickFixCount?: number;
}

export async function getLiveUpdateStatus(): Promise<LiveUpdateStatus | null> {
  const stored = await browser.storage.local.get(STATUS_KEY);
  return (stored[STATUS_KEY] as LiveUpdateStatus | undefined) ?? null;
}

async function setStatus(status: LiveUpdateStatus): Promise<void> {
  await browser.storage.local.set({ [STATUS_KEY]: status });
}

async function refreshRedirectDomains(): Promise<number> {
  // No `cache: "no-store"`: it forced every fetch past the CDN edge to origin.
  // The freshness guard above already keeps this to ~once/day, so honouring
  // the host's Cache-Control (an edge hit / 304) is the cheaper path at scale.
  const response = await fetch(LIVE_DATA_URL);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const fetched = (await response.json()) as unknown;
  if (!Array.isArray(fetched)) throw new Error("live redirect-domains payload was not an array");

  // fetched is remote, GitHub-hosted content -- validate its shape before
  // trusting it the same way customRules.ts validates user-typed domains,
  // so one malformed upstream entry can't throw partway through and
  // silently drop the whole day's refresh.
  const { valid: domains } = filterValidRedirectDomains(fetched.filter((d): d is string => typeof d === "string"));

  await addLiveRedirectDomains(domains);
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: allLiveDynamicRuleIds(),
    addRules: buildDynamicRedirectRules(domains),
  });
  return domains.length;
}

async function refreshQuickFixes(): Promise<number> {
  const response = await fetch(QUICK_FIXES_URL);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const fetched = (await response.json()) as unknown;
  if (!Array.isArray(fetched)) throw new Error("quick-fixes payload was not an array");

  const { valid: entries } = filterValidQuickFixes(fetched);
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: allQuickFixRuleIds(),
    addRules: buildQuickFixRules(entries),
  });
  return entries.length;
}

async function fetchAndApply(): Promise<void> {
  if (shouldSkipRefetch(await getLiveUpdateStatus(), Date.now())) return;

  try {
    const domainCount = await refreshRedirectDomains();

    // A quick-fixes fetch failure shouldn't fail the whole refresh or touch
    // whatever quick-fix rules are already applied from the last successful
    // one -- the redirect-domain list above is the more load-bearing half
    // of this alarm, and updateDynamicRules is only called on success below.
    let quickFixCount: number | undefined;
    try {
      const count = await refreshQuickFixes();
      quickFixCount = count > 0 ? count : undefined;
    } catch {
      // Keep whatever quick-fix rules (if any) are already active.
    }

    await setStatus({ ok: true, timestamp: Date.now(), domainCount, quickFixCount });
  } catch {
    // Offline, GitHub unreachable, rate-limited -- keep the bundled
    // baseline and try again on the next alarm tick.
    await setStatus({ ok: false, timestamp: Date.now() });
  }
}

async function refresh(): Promise<void> {
  await fetchAndApply();

  // Piggybacks on this same daily alarm rather than adding a new one: a
  // filter group that got dropped for lack of shared static-rule budget
  // (see filterGroups.ts) doesn't get proactively rechecked otherwise --
  // Moat's own budget-warning copy suggests disabling other extensions,
  // and Chrome (128+) does free that budget when a user does, but nothing
  // notices on its own outside of a service-worker cold start that happens
  // to occur. `force: true` bypasses the "nothing changed" fast path so
  // this actually re-checks reality once a day, in both directions --
  // recovers budget that freed up, and would also catch budget getting
  // worse for a state that used to fit fully. No new permission needed;
  // reuses the `alarms` permission this daily refresh already has.
  await reapplySettings({ force: true }).catch(() => {
    // Best-effort -- a failure here shouldn't affect this alarm's reported
    // status above, which is specifically about the redirect/quick-fix
    // fetch, not filter-group reconciliation.
  });
}

async function ensureAlarm(): Promise<void> {
  // Create-if-absent, never unconditionally: alarms.create with an existing
  // name *replaces* it and resets its schedule, so recreating on every
  // service-worker cold start (which is when initLiveUpdates runs) kept
  // pushing the first fire out and could fire far more than daily. Leaving an
  // existing alarm alone keeps the ~24h cadence stable across worker churn;
  // the jittered initial delay only applies to the very first creation.
  const existing = await browser.alarms.get(ALARM_NAME);
  if (existing) return;
  await browser.alarms.create(ALARM_NAME, {
    delayInMinutes: INITIAL_DELAY_MIN + Math.random() * INITIAL_DELAY_JITTER_MIN,
    periodInMinutes: PERIOD_MINUTES,
  });
}

export function initLiveUpdates(): void {
  void ensureAlarm();

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void refresh();
  });
}

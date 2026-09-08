// Keeps the redirect/popup domain list fresher than the extension's own
// release cadence would otherwise allow. The bulk of blocking (the ~273k
// rules from update-filters.mjs) stays static/build-time -- MV3's dynamic
// rule budget is nowhere near large enough to hold that. This narrow slice
// (currently ~500 known popup/redirect domains) is small enough to live-
// update: at most once a day, fetch whatever's currently committed to
// live/redirect-domains.json and apply it as dynamic declarativeNetRequest
// `block` rules plus feed the tab safety net (popupGuard.ts).
//
// The live files change only when someone runs `npm run filters:update` and
// pushes -- no scheduled automation writes to the repo. This just means a
// fresher list reaches installed copies without waiting on a new store
// release.
//
// Hosting: served from jsDelivr, a real CDN built to front GitHub repos --
// unlike raw.githubusercontent.com, which is IP-rate-limited and whose AUP
// forbids CDN-style use. jsDelivr caches a branch path for up to ~12h; run
// scripts/purge-live-cdn.mjs after pushing a fix to cut that to minutes.
//
// Integrity: `manifest.json` (SHA-256 of each payload, from
// scripts/update-live-manifest.mjs) is fetched first, then each payload is
// verified against it. This does NOT add a trust anchor beyond TLS + the
// GitHub account -- the manifest itself is fetched over the wire like the
// payloads. What it does buy: corruption detection, and *atomicity* -- if the
// CDN serves a fresh manifest against a still-propagating stale payload (or
// vice versa) the mismatch is caught and the bundled baseline is kept, rather
// than a half-applied update. Source-repo compromise is still bounded only by
// the shape validators below (block/allow a set of domains -- nothing that can
// send traffic anywhere), which is the same posture the raw-GitHub fetch had.
import browser from "webextension-polyfill";
import { addLiveRedirectDomains } from "./popupGuard";
import { allLiveDynamicRuleIds, buildDynamicRedirectRules, filterValidRedirectDomains } from "./liveRedirectRules";
import { allQuickFixRuleIds, buildQuickFixRules, filterValidQuickFixes } from "./quickFixRules";
import { reapplySettings } from "./settings";

// One base for all three live files. To move off jsDelivr later (GitHub Pages,
// Cloudflare, an object bucket) only this constant changes -- the SHA-256
// verification below makes the host untrusted either way.
const LIVE_BASE_URL = "https://cdn.jsdelivr.net/gh/Samuelabhinav37/moat@master/live";

/** Lowercase hex SHA-256 of `bytes`. Pure; exported for tests. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch `${LIVE_BASE_URL}/${name}`, reject on a hash that doesn't match the
 * shipped manifest, otherwise return the parsed JSON. */
async function fetchVerified(name: string, expectedHash: string | undefined): Promise<unknown> {
  if (!expectedHash) throw new Error(`live manifest has no hash for ${name}`);
  const response = await fetch(`${LIVE_BASE_URL}/${name}`);
  if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
  const bytes = await response.arrayBuffer();
  const actual = await sha256Hex(bytes);
  if (actual !== expectedHash) throw new Error(`${name}: hash mismatch (expected ${expectedHash}, got ${actual})`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

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

async function fetchLiveManifest(): Promise<Record<string, string>> {
  // No `cache: "no-store"` anywhere in this file now: it forced every fetch
  // past the CDN edge to origin. The freshness guard keeps this to ~once/day,
  // so honouring the host's Cache-Control (an edge hit / 304) is cheaper.
  const response = await fetch(`${LIVE_BASE_URL}/manifest.json`);
  if (!response.ok) throw new Error(`manifest: ${response.status} ${response.statusText}`);
  const parsed = (await response.json()) as { files?: unknown };
  const files = parsed.files;
  if (typeof files !== "object" || files === null) throw new Error("live manifest has no files map");
  return files as Record<string, string>;
}

async function refreshRedirectDomains(expectedHash: string | undefined): Promise<number> {
  const fetched = await fetchVerified("redirect-domains.json", expectedHash);
  if (!Array.isArray(fetched)) throw new Error("live redirect-domains payload was not an array");

  // Validate each entry's shape (same as customRules.ts does for user input)
  // so one malformed entry can't throw partway through and drop the refresh.
  const { valid: domains } = filterValidRedirectDomains(fetched.filter((d): d is string => typeof d === "string"));

  await addLiveRedirectDomains(domains);
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: allLiveDynamicRuleIds(),
    addRules: buildDynamicRedirectRules(domains),
  });
  return domains.length;
}

async function refreshQuickFixes(expectedHash: string | undefined): Promise<number> {
  const fetched = await fetchVerified("quick-fixes.json", expectedHash);
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
    const hashes = await fetchLiveManifest();
    const domainCount = await refreshRedirectDomains(hashes["redirect-domains.json"]);

    // A quick-fixes fetch failure shouldn't fail the whole refresh or touch
    // whatever quick-fix rules are already applied from the last successful
    // one -- the redirect-domain list above is the more load-bearing half
    // of this alarm, and updateDynamicRules is only called on success below.
    let quickFixCount: number | undefined;
    try {
      const count = await refreshQuickFixes(hashes["quick-fixes.json"]);
      quickFixCount = count > 0 ? count : undefined;
    } catch {
      // Keep whatever quick-fix rules (if any) are already active.
    }

    await setStatus({ ok: true, timestamp: Date.now(), domainCount, quickFixCount });
  } catch {
    // Offline, CDN unreachable, or a hash that didn't match the shipped
    // manifest -- keep the bundled baseline and try again on the next tick.
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

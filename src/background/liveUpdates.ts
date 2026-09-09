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
// Hosting: GitHub Pages (gh-pages branch, published by
// .github/workflows/publish-live.yml on any push that touches live/).
// Cache-Control: max-age=600, Cloudflare-fronted, no rate limit, no AUP
// problem, and a push propagates in minutes -- no purge step. LIVE_BASE_URL
// is the only knob if this ever moves again (a bucket, Cloudflare Pages);
// the signature + hash checks below make the host untrusted regardless.
//
// Integrity, two layers:
//   1. Ed25519 signature over `manifest.json` (liveSignature.ts) -- when a
//      public key is configured in src/shared/liveSigningKey.ts. A manifest
//      whose signature doesn't verify is rejected outright, so trust rests on
//      the offline signing key, not on the GitHub account or the CDN. Until a
//      key is set the check is skipped and layer 2 alone applies (the
//      behaviour that shipped before signing).
//   2. SHA-256 of each payload, listed in the manifest, checked before apply.
//      Catches corruption and *atomicity* -- a fresh manifest served against a
//      still-propagating stale payload is caught and the baseline kept.
// Either way, the shape validators below bound a bad payload to "block/allow a
// set of domains" -- nothing that can send traffic anywhere.
import browser from "webextension-polyfill";
import { addLiveRedirectDomains } from "./popupGuard";
import { allLiveDynamicRuleIds, buildDynamicRedirectRules, filterValidRedirectDomains } from "./liveRedirectRules";
import { allQuickFixRuleIds, buildQuickFixRules, filterValidQuickFixes } from "./quickFixRules";
import { countCosmeticFixSelectors, filterValidCosmeticFixes } from "./liveCosmeticFixes";
import { verifyLiveManifest } from "./liveSignature";
import { reapplySettings } from "./settings";
import { LIVE_COSMETIC_FIXES_KEY, LIVE_REDIRECT_DOMAINS_KEY, LIVE_YOUTUBE_QUICK_FIXES_KEY } from "../types";

const LIVE_BASE_URL = "https://samuelabhinav37.github.io/moat/live";

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
  // Omitted entirely when there are none active -- the common case -- rather
  // than shown as "0" every time, keeping the status line quiet unless there's
  // actually something to say.
  quickFixCount?: number;
  cosmeticFixCount?: number;
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
  const bytes = await response.arrayBuffer();

  // Ed25519 check first, when signing is configured. "bad" -> reject outright.
  // "ok" / "unverified" -> fall through to the per-payload SHA-256 check.
  const sigResult = await verifyLiveManifest(bytes, await fetchManifestSignature());
  if (sigResult === "bad") throw new Error("live manifest signature did not verify");

  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { files?: unknown };
  const files = parsed.files;
  if (typeof files !== "object" || files === null) throw new Error("live manifest has no files map");
  return files as Record<string, string>;
}

async function fetchManifestSignature(): Promise<string | null> {
  try {
    const res = await fetch(`${LIVE_BASE_URL}/manifest.json.sig`);
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

async function refreshRedirectDomains(expectedHash: string | undefined): Promise<number> {
  const fetched = await fetchVerified("redirect-domains.json", expectedHash);
  if (!Array.isArray(fetched)) throw new Error("live redirect-domains payload was not an array");

  // Validate each entry's shape (same as customRules.ts does for user input)
  // so one malformed entry can't throw partway through and drop the refresh.
  const { valid: domains } = filterValidRedirectDomains(fetched.filter((d): d is string => typeof d === "string"));

  await addLiveRedirectDomains(domains);
  // Persist so popupGuard can re-hydrate its in-memory live slice on a cold
  // start without waiting for the next non-skipped fetch.
  await browser.storage.local.set({ [LIVE_REDIRECT_DOMAINS_KEY]: domains });
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

async function refreshCosmeticFixes(expectedHash: string | undefined): Promise<number> {
  const fetched = await fetchVerified("cosmetic-fixes.json", expectedHash);
  const { valid } = filterValidCosmeticFixes(fetched);
  // Wholesale replace: the fetch is the full current map, not a diff, so a
  // selector removed upstream (fixed false positive) must actually go away.
  await browser.storage.local.set({ [LIVE_COSMETIC_FIXES_KEY]: valid });
  return countCosmeticFixSelectors(valid);
}

async function fetchAndApply(): Promise<void> {
  if (shouldSkipRefetch(await getLiveUpdateStatus(), Date.now())) return;

  try {
    const hashes = await fetchLiveManifest();
    const domainCount = await refreshRedirectDomains(hashes["redirect-domains.json"]);

    // A failure in either secondary channel shouldn't fail the whole refresh
    // or disturb whatever's already applied from the last good one -- the
    // redirect-domain list is the load-bearing half of this alarm.
    let quickFixCount: number | undefined;
    try {
      const count = await refreshQuickFixes(hashes["quick-fixes.json"]);
      quickFixCount = count > 0 ? count : undefined;
    } catch {
      // Keep whatever quick-fix rules (if any) are already active.
    }

    let cosmeticFixCount: number | undefined;
    try {
      const count = await refreshCosmeticFixes(hashes["cosmetic-fixes.json"]);
      cosmeticFixCount = count > 0 ? count : undefined;
    } catch {
      // Keep whatever cosmetic fixes are already in storage.
    }

    await setStatus({ ok: true, timestamp: Date.now(), domainCount, quickFixCount, cosmeticFixCount });
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

// YouTube's ad-slot markup churns faster than the general channel's ~daily
// cadence can track -- the general refresh piggybacks redirect-domains (the
// load-bearing half), quick-fixes and cosmetic-fixes onto one alarm sized for
// hosting-cost/Store-policy caution across every domain it covers. This is a
// second, narrower channel: one file (YouTube-hostname cosmetic selectors
// only), its own much shorter alarm, same hash-manifest-verify trust model
// (fetchVerified / fetchLiveManifest are reused as-is, not duplicated).
const YT_ALARM_NAME = "moat-youtube-quick-fixes";
const YT_PERIOD_MINUTES = 60;
// Same ratio to its period as the general channel's 18h/24h (0.75) -- long
// enough that a worker cold start mid-hour doesn't refetch, short enough that
// the hourly alarm still does real work most of the time it fires.
export const YT_MIN_REFETCH_INTERVAL_MS = 45 * 60 * 1000;
const YT_INITIAL_DELAY_MIN = 2;
const YT_INITIAL_DELAY_JITTER_MIN = 10;
const YT_STATUS_KEY = "youtubeQuickFixesStatus";

interface YoutubeQuickFixesStatus {
  ok: boolean;
  timestamp: number;
  selectorCount?: number;
}

export async function getYoutubeQuickFixesStatus(): Promise<YoutubeQuickFixesStatus | null> {
  const stored = await browser.storage.local.get(YT_STATUS_KEY);
  return (stored[YT_STATUS_KEY] as YoutubeQuickFixesStatus | undefined) ?? null;
}

async function setYoutubeStatus(status: YoutubeQuickFixesStatus): Promise<void> {
  await browser.storage.local.set({ [YT_STATUS_KEY]: status });
}

async function refreshYoutubeQuickFixes(expectedHash: string | undefined): Promise<number> {
  const fetched = await fetchVerified("youtube-quick-fixes.json", expectedHash);
  const { valid } = filterValidCosmeticFixes(fetched);
  // Same wholesale-replace reasoning as refreshCosmeticFixes: the fetch is
  // the full current map, not a diff.
  await browser.storage.local.set({ [LIVE_YOUTUBE_QUICK_FIXES_KEY]: valid });
  return countCosmeticFixSelectors(valid);
}

async function fetchAndApplyYoutubeQuickFixes(): Promise<void> {
  if (shouldSkipRefetch(await getYoutubeQuickFixesStatus(), Date.now(), YT_MIN_REFETCH_INTERVAL_MS)) return;

  try {
    const hashes = await fetchLiveManifest();
    const selectorCount = await refreshYoutubeQuickFixes(hashes["youtube-quick-fixes.json"]);
    await setYoutubeStatus({ ok: true, timestamp: Date.now(), selectorCount: selectorCount > 0 ? selectorCount : undefined });
  } catch {
    // Offline, CDN unreachable, or a hash mismatch -- keep whatever YouTube
    // fixes are already in storage and try again on the next hourly tick.
    await setYoutubeStatus({ ok: false, timestamp: Date.now() });
  }
}

async function ensureYoutubeAlarm(): Promise<void> {
  const existing = await browser.alarms.get(YT_ALARM_NAME);
  if (existing) return;
  await browser.alarms.create(YT_ALARM_NAME, {
    delayInMinutes: YT_INITIAL_DELAY_MIN + Math.random() * YT_INITIAL_DELAY_JITTER_MIN,
    periodInMinutes: YT_PERIOD_MINUTES,
  });
}

export function initLiveUpdates(): void {
  void ensureAlarm();
  void ensureYoutubeAlarm();

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void refresh();
    if (alarm.name === YT_ALARM_NAME) void fetchAndApplyYoutubeQuickFixes();
  });
}

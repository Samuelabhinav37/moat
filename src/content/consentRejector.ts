// Isolated-world content script, top frame only, on by default (Settings ->
// "Auto-reject cookie banners"; registered at runtime by
// background/optionalContentScripts.ts only while that setting is on).
// Cosmetic filtering already hides banners that match a plain selector, but AdGuard's own Cookie
// Notices list mostly handles the "click reject for me" half via scriptlets
// -- arbitrary injected JS Moat deliberately never executes (see README).
// This is the alternative that keeps that boundary intact: a small,
// from-scratch interpreter (./consent/) for Consent-O-Matic's declarative
// rule format (https://github.com/cavi-au/Consent-O-Matic, MIT-licensed) --
// inert JSON describing which selector to click, not code to run. Every
// consent category defaults to reject (consent/types.ts's REJECT_ALL),
// Consent-O-Matic's own out-of-the-box default too.
//
// When no curated CMP matches a snapshot, consent/heuristicFallback.ts gets
// a turn -- a text-pattern-only reject-button finder for banners outside
// the curated list, same never-inject/eval boundary, only acts when
// unambiguous. See that file's header for the confidence-gating design.
//
// A banner can mount well after the page's initial load (its own script
// still loading, an async consent-platform handshake, etc.), so this polls
// for one for a bounded window rather than running once and giving up --
// but unlike feedAdScanner.ts's continuous per-scroll scanning, this always
// stops itself: either it successfully rejects something, or the time
// budget below runs out.
//
// The full rules (about 140 KB) load only once one of their platforms is on
// the page (consent/presence.ts); until 0.11.283 every page fetched and
// parsed them.
import browser from "webextension-polyfill";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { effectiveValue } from "../shared/perSiteOverrides";
import { buildCmps, runConsentRejection } from "./consent/engine";
import { runHeuristicFallback } from "./consent/heuristicFallback";
import { looksLikeConsentNode } from "./consent/consentNode";
import type { RuleSet } from "./consent/types";
import { STORAGE_KEY, type RecordUsageSignalMessage } from "../types";
import type { Cmp } from "./consent/cmp";
import { platformPresent, type ConsentPresence } from "./consent/presence";

/** Every platform's present-matcher targets (scripts/lib/consentPresence.mjs),
 * inlined at build time: the full rules load only when one is on the page. */
declare const __MOAT_CONSENT_PRESENCE__: ConsentPresence;

function reportRejected(): void {
  const message: RecordUsageSignalMessage = {
    type: "record-usage-signal",
    signal: "cookieBannerReject",
    hostname: location.hostname,
  };
  browser.runtime.sendMessage(message).catch(() => {});
}

const MAX_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 300;

async function isEnabled(): Promise<boolean> {
  const effective = await getEffectiveSettingsHere();
  return effectiveValue(effective, location.hostname, "cookieBannerAutoReject") && !isDisabled(effective);
}

async function fetchRuleSet(): Promise<RuleSet> {
  const response = await fetch(browser.runtime.getURL("rules/consent-rules.json"));
  return (await response.json()) as RuleSet;
}

// Settings.cookieBannerAutoReject is only checked once at startup below --
// react live to it changing so switching it off in options.html actually
// stops an in-flight watch on an already-open tab instead of waiting out
// its own (bounded, at most MAX_WAIT_MS) polling window, matching the
// pattern feedAdScanner.ts/youtubeAdDimmer.ts use for the same class of
// setting. null when nothing is currently watching.
let activeCleanup: (() => void) | null = null;

function watchAndReject(): void {
  // Built from the rules once a platform shows up; until then, and on pages
  // without one, only the heuristic fallback runs (as it did whenever no
  // platform matched).
  let cmps: Cmp[] | null = null;
  let stopped = false;
  let attemptInFlight = false;
  let observer: MutationObserver | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function cleanup(): void {
    stopped = true;
    observer?.disconnect();
    if (intervalId !== null) clearInterval(intervalId);
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (activeCleanup === cleanup) activeCleanup = null;
  }
  activeCleanup = cleanup;

  async function attempt(): Promise<void> {
    if (stopped || attemptInFlight) return;
    attemptInFlight = true;
    try {
      if (cmps === null && platformPresent(__MOAT_CONSENT_PRESENCE__)) cmps = buildCmps(await fetchRuleSet());
      const result = cmps ? await runConsentRejection(cmps) : { handled: false };
      if (result.handled) {
        reportRejected();
        cleanup();
        return;
      }
      // No curated CMP matched this snapshot -- try the heuristic fallback
      // for a banner Consent-O-Matic's list doesn't recognize. Never
      // preempts a curated match: only reached when runConsentRejection
      // just reported handled: false above.
      if (runHeuristicFallback().handled) {
        reportRejected();
        cleanup();
      }
    } finally {
      attemptInFlight = false;
    }
  }

  // A full pass on every mutation batch kept a busy page's main thread
  // occupied for the whole 8 s while it was still building itself. The
  // poll below already re-checks every 300 ms; a DOM change only triggers
  // an immediate pass when what was added looks like a consent banner. That
  // pass has to be immediate: Moat's own cosmetic CSS hides many banners
  // within a few hundred ms, leaving a zero-size reject button nothing can
  // click.
  observer = new MutationObserver((records) => {
    if (stopped) return;
    if (records.some((record) => Array.from(record.addedNodes).some(looksLikeConsentNode))) void attempt();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  intervalId = setInterval(() => void attempt(), POLL_INTERVAL_MS);
  timeoutId = setTimeout(cleanup, MAX_WAIT_MS);

  void attempt(); // the banner may already be present at document_idle
}

async function start(): Promise<void> {
  if (activeCleanup) return; // already watching
  if (!(await isEnabled())) return;
  watchAndReject();
}

async function run(): Promise<void> {
  await start();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "managed" && !(area === "local" && STORAGE_KEY in changes)) return;
  void (async () => {
    if (await isEnabled()) await start();
    else activeCleanup?.();
  })();
});

void run();

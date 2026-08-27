// Isolated-world content script, top frame only, opt-in and off by default
// (Settings -> "Auto-reject cookie banners"). Cosmetic filtering already
// hides banners that match a plain selector, but AdGuard's own Cookie
// Notices list mostly handles the "click reject for me" half via scriptlets
// -- arbitrary injected JS Moat deliberately never executes (see README).
// This is the alternative that keeps that boundary intact: a small,
// from-scratch interpreter (./consent/) for Consent-O-Matic's declarative
// rule format (https://github.com/cavi-au/Consent-O-Matic, MIT-licensed) --
// inert JSON describing which selector to click, not code to run. Every
// consent category defaults to reject (consent/types.ts's REJECT_ALL),
// Consent-O-Matic's own out-of-the-box default too.
//
// A banner can mount well after the page's initial load (its own script
// still loading, an async consent-platform handshake, etc.), so this polls
// for one for a bounded window rather than running once and giving up --
// but unlike feedAdScanner.ts's continuous per-scroll scanning, this always
// stops itself: either it successfully rejects something, or the time
// budget below runs out.
import browser from "webextension-polyfill";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { buildCmps, runConsentRejection } from "./consent/engine";
import type { RuleSet } from "./consent/types";
import { STORAGE_KEY } from "../types";

const MAX_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 300;

async function isEnabled(): Promise<boolean> {
  const effective = await getEffectiveSettingsHere();
  return effective.cookieBannerAutoReject && !isDisabled(effective);
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

function watchAndReject(ruleSet: RuleSet): void {
  const cmps = buildCmps(ruleSet);
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
      const result = await runConsentRejection(cmps);
      if (result.handled) cleanup();
    } finally {
      attemptInFlight = false;
    }
  }

  observer = new MutationObserver(() => void attempt());
  observer.observe(document.body, { childList: true, subtree: true });
  intervalId = setInterval(() => void attempt(), POLL_INTERVAL_MS);
  timeoutId = setTimeout(cleanup, MAX_WAIT_MS);

  void attempt(); // the banner may already be present at document_idle
}

async function start(): Promise<void> {
  if (activeCleanup) return; // already watching
  if (!(await isEnabled())) return;
  const ruleSet = await fetchRuleSet();
  watchAndReject(ruleSet);
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

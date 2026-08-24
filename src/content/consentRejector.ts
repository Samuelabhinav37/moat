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
import { isDisabledHere } from "./siteDisabled";
import { runConsentRejection } from "./consent/engine";
import type { RuleSet } from "./consent/types";
import { STORAGE_KEY, type Settings } from "../types";

const MAX_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 300;

async function isEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  return (settings?.cookieBannerAutoReject ?? false) && !(await isDisabledHere());
}

async function fetchRuleSet(): Promise<RuleSet> {
  const response = await fetch(browser.runtime.getURL("rules/consent-rules.json"));
  return (await response.json()) as RuleSet;
}

function watchAndReject(ruleSet: RuleSet): void {
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
  }

  async function attempt(): Promise<void> {
    if (stopped || attemptInFlight) return;
    attemptInFlight = true;
    try {
      const result = await runConsentRejection(ruleSet);
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

async function run(): Promise<void> {
  if (!(await isEnabled())) return;
  const ruleSet = await fetchRuleSet();
  watchAndReject(ruleSet);
}

void run();

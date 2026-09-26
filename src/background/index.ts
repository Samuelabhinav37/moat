import browser, { type Runtime } from "webextension-polyfill";
import {
  onLiveBlock,
  forgetTab,
  refreshStaticBreakdown,
  resetForNavigation,
} from "./blockStats";
import {
  applyFreshInstallDefaults,
  getEffectiveSettings,
  reapplySettings,
  seedFromSyncIfEmpty,
  setSettings,
} from "./settings";
import { recordUpdateSeen } from "./updateNotice";
import { maybeOpenFirstRunTour } from "./firstRunTour";
import { initPopupGuard } from "./popupGuard";
import { initLiveUpdates } from "./liveUpdates";
import { getManagedPolicy } from "./managedPolicy";
import { initAthenaIntegration, reconcileAthenaAlarm } from "./athenaIntegration";
import { isPolicyBlockedHostname } from "./athenaPolicySync";
import { forgetTab as forgetBlockReasonTab, recordBlockedHostname } from "./athenaBlockReason";
import { safeHostname } from "./redirectDomainMatch";
import { forgetTab as forgetLoggerTab, initRuleLogger } from "./ruleLogger";
import { forgetTab as forgetLastNormalTab, noteTabUrl } from "./lastNormalTab";
import { recentMatchedRulesCalls } from "./matchStats";
import { startLiveBlockCounting } from "./liveBlocks";
import { handleMessage, hostnameOf } from "./messageRouter";
import { forgetTab as forgetHeuristicTab, resetForNavigation as resetHeuristicFiring } from "./liveHeuristics";
import { reconcileCustomRuleStats } from "./customRuleStats";
import { injectCosmeticsForCommit } from "./cosmeticInject";

initPopupGuard();
initLiveUpdates();
initRuleLogger();
// No-op on every normal install -- see athenaIntegration.ts. Only does
// anything once an org's own managed policy provisions ManagedPolicy.athena.
initAthenaIntegration(getManagedPolicy);
// Shared by both call sites below. seedFromSyncIfEmpty/applyFreshInstallDefaults
// each independently check "is storage.local genuinely still empty?" right
// before writing, so calling this twice in a row (once from the
// unconditional bootstrap below, once from onInstalled when it fires) is
// safe -- whichever runs first wins, and the other becomes a no-op. What
// matters is the ORDER *within* one call: seed-from-sync must get its
// chance before the fresh-install lite defaults do, so a real synced
// settings copy from another device always wins over the generic default.
async function initializeSettings(reason?: Runtime.OnInstalledReason): Promise<void> {
  await seedFromSyncIfEmpty();
  if (reason === "install") await applyFreshInstallDefaults();
  await reapplySettings();
  // Sweeps any customRuleStats.ts entry whose underlying rule no longer
  // exists in Settings (an import, or a managed-policy change, that
  // bypassed the explicit remove-rule wrappers) -- cheap and a no-op once
  // nothing's orphaned, safe to run on every cold start.
  void getEffectiveSettings().then(reconcileCustomRuleStats);
}

// Note: not a top-level `await` -- this module is built as a Rollup `iife`
// bundle (see scripts/build.mjs), which doesn't support it. No reason here --
// this path covers ordinary service-worker wake-ups (browser restart, SW
// idle timeout) where onInstalled never fires at all.
void initializeSettings();

// Fires on "install", "update", and "browser_update". On a fresh install
// this both records the baseline version (there's nothing to compare
// against yet, so no notice -- which is exactly what lets the *next* real
// update be detected) and seeds the "standard" filter-group defaults
// (see filterPresets.ts); on every other reason, initializeSettings behaves
// the same as the unconditional call above.
browser.runtime.onInstalled.addListener((details) => {
  void recordUpdateSeen();
  void initializeSettings(details.reason);
  void maybeOpenFirstRunTour(details.reason);
});

// An admin can push/change managed policy at any point during a session
// (not just at browser startup) -- reapply everything when that happens,
// same as we already do for the user's own settings changes. Also
// reconciles the Athena flush alarm's existence (see reconcileAthenaAlarm's
// own comment): a policy push that newly configures or removes Athena
// should create or clear that alarm right away, not only on the next
// service-worker restart.
browser.storage.onChanged.addListener((_changes, area) => {
  if (area !== "managed") return;
  void reapplySettings();
  void getManagedPolicy().then(reconcileAthenaAlarm);
});

browser.commands.onCommand.addListener((command) => {
  if (command !== "toggle-protection") return;
  void (async () => {
    const current = await getEffectiveSettings();
    await setSettings({ enabled: !current.enabled });
  })();
});

browser.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  forgetLoggerTab(tabId);
  forgetBlockReasonTab(tabId);
  forgetLastNormalTab(tabId);
  forgetHeuristicTab(tabId);
});

// Track which normal web page the user last had focused, so the Settings
// "Trackers" tab -- itself an extension page with no page of its own -- can
// ask about it (see lastNormalTab.ts). onActivated has no url, so fetch it.
browser.tabs.onActivated.addListener(({ tabId }) => {
  void browser.tabs
    .get(tabId)
    .then((tab) => noteTabUrl(tabId, tab?.url))
    .catch(() => {});
});
// Seed it once at startup with the currently-focused tab.
void browser.tabs
  .query({ active: true, lastFocusedWindow: true })
  .then(([tab]) => {
    if (tab?.id !== undefined) noteTabUrl(tab.id, tab.url);
  })
  .catch(() => {});


// Quota-free count of refused requests per tab (see liveBlocks.ts). Top
// level, so a blocked request can wake the worker.
startLiveBlockCounting(onLiveBlock);

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  resetForNavigation(details.tabId, details.timeStamp);
  resetHeuristicFiring(details.tabId);
  // Inject the bundled + user cosmetic CSS as a user-origin stylesheet from
  // here, instead of the content script building a <style> on the page
  // thread. Fires early enough to be roughly document_start-class; no-ops
  // when protection is off/paused for this host.
  void injectCosmeticsForCommit(details.tabId, details.url);
});

// Fires with the ORIGINAL requested URL, before declarativeNetRequest's
// redirect (see athenaPolicyRules.ts) ever resolves -- the one point where
// the extension can still see what a tab was actually trying to reach.
// isPolicyBlockedHostname is a plain in-memory Set lookup (see
// athenaPolicySync.ts), so this is cheap on every normal install too, where
// the set is always empty and this always no-ops.
browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  const hostname = safeHostname(details.url);
  if (hostname && isPolicyBlockedHostname(hostname)) recordBlockedHostname(details.tabId, hostname);
});

// Static ads/trackers/popups counts come from declarativeNetRequest's own
// match feedback, read once the page has finished loading (onCommitted only
// clears the previous page's numbers). Ads keep loading after the load
// event: on weather.com 7 requests were blocked by then and 27 within ten
// seconds. So the active tab gets one more read a little later, and the
// popup reads again when it opens. getMatchedRules allows 20 calls per 10
// minutes, which is why the late read is for the active tab only.
const LATE_REFRESH_MS = 8000;
// Leave 5 of Chrome's 20 getMatchedRules calls per 10 minutes for popup opens.
const LATE_REFRESH_CALL_BUDGET = 15;
browser.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  void refreshStaticBreakdown(details.tabId, hostnameOf(details.url));
  setTimeout(() => {
    void browser.tabs
      .get(details.tabId)
      .then((tab) => {
        if (tab.active && tab.url === details.url && recentMatchedRulesCalls() < LATE_REFRESH_CALL_BUDGET) {
          return refreshStaticBreakdown(details.tabId, hostnameOf(details.url));
        }
      })
      .catch(() => {
        // Tab closed in the meantime.
      });
  }, LATE_REFRESH_MS);
  // Also covers navigating an already-active tab, which fires no onActivated.
  noteTabUrl(details.tabId, details.url);
});

browser.runtime.onMessage.addListener(handleMessage);

import browser, { type Runtime } from "webextension-polyfill";
import {
  combinedBreakdown,
  combinedCompanyBreakdown,
  combinedTotal,
  forgetTab,
  recordDynamicCatch,
  refreshStaticBreakdown,
  resetForNavigation,
} from "./blockStats";
import {
  addCustomAllowedDomain,
  addCustomBlockedDomain,
  addCustomCosmeticRule,
  addGrayscaleRule,
  applyFreshInstallDefaults,
  getEffectiveSettings,
  getOrCreateFingerprintSeed,
  getOrCreateSessionFingerprintSeed,
  scopeFingerprintSeedToSite,
  getSettings,
  importCustomRules,
  isSiteDisabled,
  pickAllowedSettingsPatch,
  reapplySettings,
  removeCustomAllowedDomain,
  removeCustomBlockedDomain,
  removeCustomCosmeticRule,
  removeGrayscaleRule,
  seedFromSyncIfEmpty,
  setPerSiteOverride,
  setSettings,
  setSiteDisabled,
} from "./settings";
import { OVERRIDABLE_KEYS } from "../shared/perSiteOverrides";
import { exportSettings, isBoundedStringArray, isSelectorMap, validateImportedSettings } from "./settingsPortability";
import { dismissOnboarding, dismissUpdateNotice, getPopupUiNotices, recordUpdateSeen } from "./updateNotice";
import { maybeOpenFirstRunTour } from "./firstRunTour";
import { initPopupGuard } from "./popupGuard";
import { fetchAndApply, initLiveUpdates } from "./liveUpdates";
import { getManagedPolicy } from "./managedPolicy";
import { initAthenaIntegration, queueSecurityEvent, reconcileAthenaAlarm } from "./athenaIntegration";
import { isPolicyBlockedHostname } from "./athenaPolicySync";
import { forgetTab as forgetBlockReasonTab, getBlockedHostname, recordBlockedHostname } from "./athenaBlockReason";
import { safeHostname } from "./redirectDomainMatch";
import { forgetTab as forgetLoggerTab, getEntries as getLoggedEntries, initRuleLogger, isSupported as isLoggerSupported } from "./ruleLogger";
import { loadRulesetManifest } from "./rulesetManifestLoader";
import { summarizeFilterLists } from "../shared/rulesetManifest";
import { effectiveFilterGroupState } from "./filterGroupState";
import { getFilterGroupStatus } from "./filterGroups";
import type {
  AthenaBlockReasonResponse,
  CompanyBreakdownResponse,
  FilterListMatchesResponse,
  FingerprintSeedResponse,
  ImportSettingsResponse,
  LogEntriesResponse,
  ReportContextResponse,
  RuntimeMessage,
  StartElementPickerResponse,
  StatusResponse,
} from "../types";
import type { PopupUiNotices } from "./updateNotice";
import {
  forgetTab as forgetLastNormalTab,
  getLastNormalTabId,
  isNormalPageUrl,
  noteTabUrl,
  pickBestNormalTab,
} from "./lastNormalTab";
import { getGroupBreakdown, isMatchedRulesSupported } from "./matchStats";
import { recordSignalEvent } from "./usageStats";
import { SIGNAL_KEYS } from "../shared/usageStatsState";
import {
  forgetTab as forgetHeuristicTab,
  getFired,
  recordFired,
  resetForNavigation as resetHeuristicFiring,
} from "./liveHeuristics";
import { HEURISTIC_DEFS, heuristicAppliesTo } from "../shared/heuristicScope";
import { reconcileCustomRuleStats, recordRuleMatches } from "./customRuleStats";
import { cosmeticGenericsFor, proceduralRulesFor } from "./cosmeticIndex";
import { allowPermissionGuardOrigin } from "./permissionGuard";
import { injectCosmeticsForCommit, injectGenericSelectors } from "./cosmeticInject";
import {
  MAX_OVERRIDE_REASON_LENGTH,
  clampUsageSignalCount,
  isHostnameSelectorHits,
  isValidMessageString,
} from "./messageValidation";

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

/** getLastNormalTabId(), confirmed still open and still a normal page, with a
 * live fallback when the cached pointer is stale or was never set at all.
 * The pointer resets to null on every service-worker cold start (MV3 kills
 * an idle worker routinely), and the startup reseed above only looks at the
 * currently-focused tab -- if that happens to be the Settings page itself
 * (open in its own tab, exactly when someone's most likely to be using it),
 * noteTabUrl ignores it (extension pages never count, see lastNormalTab.ts)
 * and the pointer is left null with nothing else to fall back on. A live
 * query here fixes that instead of trusting state that may never exist,
 * rather than silently failing "Pick an element" / the Trackers and Filter
 * Lists tabs' per-tab breakdowns. */
async function resolveNormalTabId(): Promise<number | null> {
  const cached = getLastNormalTabId();
  if (cached !== null) {
    const tab = await browser.tabs.get(cached).catch(() => undefined);
    if (isNormalPageUrl(tab?.url)) return cached;
  }
  const active = await browser.tabs.query({ active: true }).catch(() => []);
  return pickBestNormalTab(active);
}

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
browser.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  void refreshStaticBreakdown(details.tabId, hostnameOf(details.url));
  setTimeout(() => {
    void browser.tabs
      .get(details.tabId)
      .then((tab) => {
        if (tab.active && tab.url === details.url) return refreshStaticBreakdown(details.tabId, hostnameOf(details.url));
      })
      .catch(() => {
        // Tab closed in the meantime.
      });
  }, LATE_REFRESH_MS);
  // Also covers navigating an already-active tab, which fires no onActivated.
  noteTabUrl(details.tabId, details.url);
});

function hostnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return typeof value === "object" && value !== null && "type" in value;
}

browser.runtime.onMessage.addListener((raw: unknown, sender: Runtime.MessageSender) => {
  if (!isRuntimeMessage(raw)) return undefined;
  const message = raw;

  switch (message.type) {
    case "blocked": {
      if (sender.tab?.id !== undefined) void recordDynamicCatch(sender.tab.id, hostnameOf(sender.tab.url));
      // Cross-browser event source (unlike the getMatchedRules-based one in
      // matchStats.ts, which is Chrome-only) -- no-ops instantly on every
      // normal install, same as that one. message.url is already the exact
      // thing the popup/redirect firewall caught -- domain-only, matching
      // the same minimization the "override" event already uses, and the
      // one AthenaSecurityEvent category that was silently omitting it
      // despite having it on hand (see the systems audit this fixes).
      const domain = hostnameOf(message.url ?? undefined) || undefined;
      void getManagedPolicy().then((policy) =>
        queueSecurityEvent(policy, { category: "popup-redirect", riskTier: "medium", domain })
      );
      return undefined;
    }

    case "get-status": {
      return (async (): Promise<StatusResponse> => {
        // Content scripts have a sender.tab; popup.html/options.html don't,
        // so fall back to whichever tab the user is currently looking at.
        const tab = sender.tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
        const hostname = hostnameOf(tab?.url);
        // The popup is opening: read the latest matches so its numbers
        // include everything blocked since the page loaded. If the read
        // fails (quota, tab gone) the last numbers stand.
        if (tab?.id !== undefined) await refreshStaticBreakdown(tab.id, hostname);
        const [settings, filterStatus] = await Promise.all([getEffectiveSettings(), getFilterGroupStatus()]);
        return {
          hostname,
          siteDisabled: hostname ? await isSiteDisabled(hostname) : false,
          enabled: settings.enabled,
          blockedOnTab: tab?.id !== undefined ? combinedTotal(tab.id) : 0,
          breakdown: tab?.id !== undefined ? combinedBreakdown(tab.id) : { ads: 0, trackers: 0, popups: 0 },
          companyBreakdown: tab?.id !== undefined ? combinedCompanyBreakdown(tab.id) : {},
          droppedFilterGroups: filterStatus?.droppedGroups ?? [],
          permissionGuard: {
            camera: settings.permissionGuardCamera,
            microphone: settings.permissionGuardMicrophone,
            location: settings.permissionGuardLocation,
          },
        };
      })();
    }

    case "get-company-breakdown": {
      return (async (): Promise<CompanyBreakdownResponse> => {
        const supported = isMatchedRulesSupported();
        const tabId = await resolveNormalTabId();
        if (tabId === null) return { hostname: "", companyBreakdown: {}, supported };
        const tab = await browser.tabs.get(tabId).catch(() => undefined);
        return {
          hostname: hostnameOf(tab?.url),
          companyBreakdown: combinedCompanyBreakdown(tabId),
          supported,
        };
      })();
    }

    case "toggle-site": {
      if (!isValidMessageString(message.hostname)) return undefined;
      return setSiteDisabled(message.hostname, message.disabled).then(() => undefined);
    }

    case "set-per-site-override": {
      if (!isValidMessageString(message.hostname)) return undefined;
      if (!OVERRIDABLE_KEYS.includes(message.key)) return undefined;
      if (message.value !== null && typeof message.value !== "boolean") return undefined;
      return setPerSiteOverride(message.hostname, message.key, message.value).then(() => undefined);
    }

    case "allow-permission-guard-origin": {
      if (!isValidMessageString(message.hostname)) return undefined;
      if (message.kind !== "camera" && message.kind !== "microphone" && message.kind !== "location") {
        return undefined;
      }
      return allowPermissionGuardOrigin(message.kind, message.hostname).then(() => undefined);
    }

    case "save-cosmetic-rule": {
      if (!isValidMessageString(message.hostname) || !isValidMessageString(message.selector)) return undefined;
      return addCustomCosmeticRule(message.hostname, message.selector).then(() => undefined);
    }

    case "save-grayscale-rule": {
      if (!isValidMessageString(message.hostname) || !isValidMessageString(message.selector)) return undefined;
      return addGrayscaleRule(message.hostname, message.selector).then(() => undefined);
    }

    case "remove-cosmetic-rule": {
      if (!isValidMessageString(message.hostname) || !isValidMessageString(message.selector)) return undefined;
      return removeCustomCosmeticRule(message.hostname, message.selector).then(() => undefined);
    }

    case "remove-grayscale-rule": {
      if (!isValidMessageString(message.hostname) || !isValidMessageString(message.selector)) return undefined;
      return removeGrayscaleRule(message.hostname, message.selector).then(() => undefined);
    }

    case "add-custom-domain": {
      // Returns { ok: false } rather than `undefined` on rejection -- a
      // silent `undefined` here used to look identical to a successful add
      // from the caller's side, clearing the input as if the domain had
      // been saved when it never was.
      if (!isValidMessageString(message.hostname)) return Promise.resolve({ ok: false });
      if (message.field !== "customBlockedDomains" && message.field !== "customAllowedDomains") {
        return Promise.resolve({ ok: false });
      }
      const add = message.field === "customBlockedDomains" ? addCustomBlockedDomain : addCustomAllowedDomain;
      return add(message.hostname).then(() => ({ ok: true }));
    }

    case "remove-custom-domain": {
      if (!isValidMessageString(message.hostname)) return undefined;
      if (message.field !== "customBlockedDomains" && message.field !== "customAllowedDomains") return undefined;
      const remove = message.field === "customBlockedDomains" ? removeCustomBlockedDomain : removeCustomAllowedDomain;
      return remove(message.hostname).then(() => undefined);
    }

    case "import-custom-rules": {
      // Reject the whole message on any shape mismatch, no partial-trust --
      // same posture as "record-custom-rule-match"'s isHostnameSelectorHits
      // check. shared/filterListImport.ts already only ever produces
      // bounded, safe output, but the message boundary is untrusted
      // regardless of which code produced the payload on the other side.
      if (!isBoundedStringArray(message.blockedDomains)) return undefined;
      if (!isBoundedStringArray(message.allowedDomains)) return undefined;
      if (!isSelectorMap(message.cosmeticRules)) return undefined;
      return importCustomRules(message);
    }

    // options.ts's own toggles/presets patch settings through this rather
    // than importing setSettings directly -- see SETTINGS_PATCH_ALLOWED_FIELDS'
    // own comment in types.ts for why pickAllowedSettingsPatch doesn't just
    // trust message.patch as-is.
    case "set-settings-patch": {
      return setSettings(pickAllowedSettingsPatch(message.patch)).then(() => undefined);
    }

    case "get-cosmetic-generics": {
      // hostname/hashes come from the DOM surveyor in a content script the
      // TS types trust, but the listener validates the boundary itself --
      // same stance as every other case here.
      if (!isValidMessageString(message.hostname) || !Array.isArray(message.hashes)) return undefined;
      const hashes = message.hashes.filter((h): h is string => typeof h === "string" && h.length > 0 && h.length <= 16);
      if (hashes.length === 0) return Promise.resolve({ selectors: [] });
      return (async () => {
        const { selectors } = await cosmeticGenericsFor(message.hostname, hashes);
        // Inject worker-side, same user-origin stylesheet path as the
        // up-front CSS. The selectors are still returned so the surveyor
        // knows the batch was productive (its self-disable counter).
        if (sender.tab?.id !== undefined) {
          void injectGenericSelectors(sender.tab.id, sender.frameId ?? 0, selectors);
        }
        return { selectors };
      })();
    }

    case "get-procedural-rules": {
      if (!isValidMessageString(message.hostname)) return undefined;
      return proceduralRulesFor(message.hostname);
    }

    case "get-fingerprint-seed": {
      return (async (): Promise<FingerprintSeedResponse> => {
        const baseSeed = message.session ? await getOrCreateSessionFingerprintSeed() : await getOrCreateFingerprintSeed();
        // sender.tab.url, not the requesting frame's own location -- see
        // scopeFingerprintSeedToSite's own comment on why a third-party
        // iframe must get the *embedding* site's scope, not its own domain.
        return { seed: scopeFingerprintSeedToSite(baseSeed, hostnameOf(sender.tab?.url)) };
      })();
    }

    case "get-report-context": {
      return (async (): Promise<ReportContextResponse> => {
        const tab = sender.tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
        const settings = await getEffectiveSettings();
        const manifest = await loadRulesetManifest();
        const lists = summarizeFilterLists(manifest);
        const state = effectiveFilterGroupState(settings.enabled, settings.filterGroups, lists.map((l) => l.group));
        return {
          hostname: hostnameOf(tab?.url),
          enabledFilterGroups: lists.filter((l) => state[l.group]).map((l) => l.name),
        };
      })();
    }

    case "export-settings": {
      // Deliberately getSettings() (raw), never getEffectiveSettings() -- an
      // org's managed-policy-forced values must never be exported as if
      // they were the user's own preference (see settingsPortability.ts).
      return (async () => exportSettings(await getSettings()))();
    }

    case "import-settings": {
      return (async (): Promise<ImportSettingsResponse> => {
        const patch = validateImportedSettings(message.payload);
        if (patch === null) return { ok: false };
        await setSettings(patch);
        return { ok: true };
      })();
    }

    case "get-ui-notices": {
      return (async (): Promise<PopupUiNotices> => getPopupUiNotices())();
    }

    case "dismiss-update-notice": {
      return dismissUpdateNotice();
    }

    case "dismiss-onboarding": {
      return dismissOnboarding();
    }

    case "get-log-entries": {
      return (async (): Promise<LogEntriesResponse> => {
        // Diagnostics is an extension page with no page of its own -- same
        // "which normal web page is this actually about" problem the
        // Trackers/Filter-Lists tabs solve with resolveNormalTabId, not the
        // diagnostics tab's own chrome-extension:// URL (sender.tab, used
        // here previously, pointed at the diagnostics tab itself).
        const tabId = await resolveNormalTabId();
        const tab = tabId === null ? undefined : await browser.tabs.get(tabId).catch(() => undefined);
        const hostname = hostnameOf(tab?.url);
        const settings = await getEffectiveSettings();
        const fired = tabId === null ? {} : getFired(tabId);
        const heuristics: LogEntriesResponse["heuristics"] = HEURISTIC_DEFS.map((def) => ({
          id: def.id,
          on: Boolean(settings[def.settingKey]),
          appliesHere: hostname ? heuristicAppliesTo(def.id, hostname) : false,
          fired: fired[def.id] ?? null,
        }));
        return {
          supported: isLoggerSupported(),
          hostname,
          entries: tabId === null ? [] : getLoggedEntries(tabId),
          heuristics,
        };
      })();
    }

    case "get-athena-block-reason": {
      return (async (): Promise<AthenaBlockReasonResponse> => ({
        hostname: sender.tab?.id !== undefined ? getBlockedHostname(sender.tab.id) : null,
      }))();
    }

    case "report-athena-override": {
      // Logged, not an instant local unblock -- see warning.ts's own
      // comment and the README's Athena-integration section for why: an
      // org's Athena instance reviewing and re-pushing an updated policy is
      // the actual mechanism that lifts a block, matching Athena's own
      // "a human approves" governing rule rather than a self-service bypass.
      if (typeof message.reason !== "string" || message.reason.length === 0 || message.reason.length > MAX_OVERRIDE_REASON_LENGTH) {
        return undefined;
      }
      if (sender.tab?.id === undefined) return undefined;
      const hostname = getBlockedHostname(sender.tab.id);
      if (!hostname) return undefined;
      return getManagedPolicy().then((policy) =>
        queueSecurityEvent(policy, { category: "override", riskTier: "low", domain: hostname, note: message.reason })
      );
    }

    case "record-usage-signal": {
      if (!isValidMessageString(message.hostname)) return undefined;
      if (!(SIGNAL_KEYS as readonly string[]).includes(message.signal)) return undefined;
      const count = clampUsageSignalCount(message.count);
      // Live, per-page-load counter for the Diagnostics page (DR-16) --
      // separate from usageStats.ts's rolling daily history below, which
      // this doesn't replace. Same `count` (searchSlop's real batch size)
      // as the history write just below, so the two never disagree.
      if (sender.tab?.id !== undefined) recordFired(sender.tab.id, message.signal, count);
      return recordSignalEvent(message.signal, message.hostname, count).then(() => undefined);
    }

    case "get-filter-list-matches": {
      return (async (): Promise<FilterListMatchesResponse> => {
        const supported = isMatchedRulesSupported();
        const tabId = await resolveNormalTabId();
        if (tabId === null) return { hostname: "", matchesByGroup: {}, supported };
        const tab = await browser.tabs.get(tabId).catch(() => undefined);
        return { hostname: hostnameOf(tab?.url), matchesByGroup: getGroupBreakdown(tabId), supported };
      })();
    }

    case "record-custom-rule-match": {
      if (!isHostnameSelectorHits(message.hideHits) || !isHostnameSelectorHits(message.grayscaleHits)) {
        return undefined;
      }
      return recordRuleMatches(message.hideHits, message.grayscaleHits).then(() => undefined);
    }

    case "check-for-live-updates": {
      return fetchAndApply({ force: true }).then(() => undefined);
    }

    case "start-element-picker": {
      return (async (): Promise<StartElementPickerResponse> => {
        const tabId = await resolveNormalTabId();
        if (tabId === null) return { ok: false };
        try {
          const tab = await browser.tabs.get(tabId);
          if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
          await browser.tabs.update(tabId, { active: true });
        } catch {
          return { ok: false };
        }
        // Same inject-on-demand fallback as popup.ts's "Block an element…"
        // button: element-picker.js only auto-injects on page load, so a
        // tab left open since before the extension was last installed/
        // reloaded has no receiver yet.
        try {
          await browser.tabs.sendMessage(tabId, { type: "start-picker" });
          return { ok: true };
        } catch {
          try {
            await browser.scripting.executeScript({ target: { tabId }, files: ["element-picker.js"] });
            await browser.tabs.sendMessage(tabId, { type: "start-picker" });
            return { ok: true };
          } catch {
            // A restricted page (chrome://, the Web Store) that content
            // scripts can never run on -- nothing more we can do.
            return { ok: false };
          }
        }
      })();
    }

    default:
      return undefined;
  }
});

import browser from "webextension-polyfill";
import type {
  AllowPermissionGuardOriginMessage,
  GetReportContextMessage,
  GetStatusMessage,
  GetUiNoticesMessage,
  ReportContextResponse,
  SetPerSiteOverrideMessage,
  StatusResponse,
  ToggleSiteMessage,
} from "../types";
import { buildIssueUrl } from "./reportIssue";
import type { PopupUiNotices } from "../background/updateNotice";
import { applyStaticI18n, getMessageOrFallback } from "../shared/i18n";
import { PROTECTION_LEVEL_MESSAGE_KEY, protectionLevelForCount } from "../shared/protectionLevel";
import { getEffectiveSettings } from "../background/settings";
import { effectiveValue, OVERRIDABLE_KEYS, type OverridableSettingKey } from "../shared/perSiteOverrides";

// Firefox for Android opens the action popup as a full-width panel with no
// toolbar anchor, so Moat's fixed 260px column reads as a narrow strip. Give
// it a device-width viewport + a class the stylesheet widens to 100% -- but
// ONLY on the Android UA, so desktop Chrome/Firefox (whose toolbar popup has
// no real viewport and is broken outright by a viewport meta, see
// v0.11.62/64) are never touched. Runs before render() so the reflow, if
// any, happens before the popup's first paint.
if (/Android/i.test(navigator.userAgent || "")) {
  document.documentElement.classList.add("moat-android");
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.append(viewport);
}

applyStaticI18n(document, (key, subs) => browser.i18n.getMessage(key, subs));

async function getStatus(): Promise<StatusResponse> {
  const message: GetStatusMessage = { type: "get-status" };
  return browser.runtime.sendMessage(message) as Promise<StatusResponse>;
}

// Both notices are "view = dismiss" -- shown once, then gone on the next
// open, with no explicit close button. A card the user has to click to
// dismiss is closer to a nag than one that's just gone next time.
async function renderUiNotices(): Promise<void> {
  const message: GetUiNoticesMessage = { type: "get-ui-notices" };
  const notices = (await browser.runtime.sendMessage(message)) as PopupUiNotices;

  const onboardingCard = document.getElementById("onboarding-card")!;
  if (notices.showOnboarding) {
    onboardingCard.hidden = false;
    void browser.runtime.sendMessage({ type: "dismiss-onboarding" });
  }

  const updateNotice = document.getElementById("update-notice")!;
  if (notices.updateAvailable) {
    document.getElementById("update-version")!.textContent = notices.updateVersion;
    updateNotice.hidden = false;
    void browser.runtime.sendMessage({ type: "dismiss-update-notice" });
  }
}

// Collapsed by default (see popup.html's <details hidden>) -- a company
// drill-down on top of the existing Ads/Trackers/Popups strip, not a
// dashboard. Hidden entirely when nothing's attributed rather than shown
// empty (most blocked requests have no company match -- TrackerDB only
// covers a fraction of the bundled domains).
function renderCompanyBreakdown(companyBreakdown: Record<string, number>): void {
  const details = document.getElementById("company-details")!;
  const list = document.getElementById("company-list")!;
  const entries = Object.entries(companyBreakdown).sort((a, b) => b[1] - a[1]);

  details.hidden = entries.length === 0;
  list.replaceChildren(
    ...entries.map(([company, count]) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = company;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(count);
      li.append(name, n);
      return li;
    })
  );
}

// [messageKey, English fallback] -- same tuple convention options.ts's own
// PROTECTIONS list uses for titleKey/descKey, so a missing/failed i18n
// lookup falls back to real text instead of the raw settings-key name.
const OVERRIDE_LABEL_KEYS: Record<OverridableSettingKey, readonly [string, string]> = {
  fingerprintResistance: ["popupOverrideFingerprint", "Block fingerprinting"],
  cookieBannerAutoReject: ["popupOverrideCookieBanner", "Auto-reject cookie banners"],
  aggressiveFeedAdRemoval: ["popupOverrideFeedAds", "Hide sponsored posts"],
  hideSeoSpamResults: ["popupOverrideSeoSpam", "Hide low-quality results"],
};

// Always shown when a hostname is known -- these 4 settings' isEnabled()
// gates already call effectiveValue() themselves (see content/bridge.ts,
// consentRejector.ts, feedAdScanner.ts, searchSlopFilterEntry.ts), so
// toggling a row here takes effect on the next check with no other plumbing.
// One direct getEffectiveSettings() read, same pattern options.ts already
// uses -- this panel doesn't go through StatusResponse since it needs the
// full settings object, not just the popup's existing per-tab summary.
async function renderSiteOverrides(hostname: string): Promise<void> {
  const details = document.getElementById("site-overrides")!;
  const list = document.getElementById("site-overrides-list")!;
  const settings = await getEffectiveSettings();

  list.replaceChildren(
    ...OVERRIDABLE_KEYS.map((key) => {
      const row = document.createElement("div");
      row.className = "override-row";

      const labelWrap = document.createElement("div");
      labelWrap.className = "label";
      const labelText = document.createElement("span");
      labelText.textContent = getMessageOrFallback(
        (k) => browser.i18n.getMessage(k),
        ...OVERRIDE_LABEL_KEYS[key]
      );
      const resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "reset";
      resetButton.textContent = getMessageOrFallback(
        (k) => browser.i18n.getMessage(k),
        "popupOverrideReset",
        "Reset"
      );
      resetButton.hidden = settings.perSiteOverrides[hostname]?.[key] === undefined;
      labelWrap.append(labelText, resetButton);

      const switchLabel = document.createElement("label");
      switchLabel.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = effectiveValue(settings, hostname, key);
      const track = document.createElement("span");
      track.className = "track";
      const thumb = document.createElement("span");
      thumb.className = "thumb";
      track.append(thumb);
      switchLabel.append(input, track);

      function send(value: boolean | null): void {
        const message: SetPerSiteOverrideMessage = { type: "set-per-site-override", hostname, key, value };
        void browser.runtime.sendMessage(message);
      }

      input.addEventListener("change", () => {
        send(input.checked);
        resetButton.hidden = false;
      });
      resetButton.addEventListener("click", () => {
        send(null);
        input.checked = settings[key];
        resetButton.hidden = true;
      });

      row.append(labelWrap, switchLabel);
      return row;
    })
  );

  details.hidden = false;
}

const PERMISSION_GUARD_LINK_IDS = {
  camera: "permission-guard-allow-camera",
  microphone: "permission-guard-allow-microphone",
  location: "permission-guard-allow-location",
} as const;

// Only shows a kind's "Allow ... here" link when that kind's guard is
// actually on (StatusResponse.permissionGuard) -- see
// background/permissionGuard.ts. Each link is scoped to the tab's own
// hostname; clicking one sends a one-shot message and hides itself rather
// than tracking live contentSettings state back (getting that right would
// need another round trip for a link the user is about to make irrelevant
// anyway by clicking it).
function renderPermissionGuardNotice(
  hostname: string,
  guard: StatusResponse["permissionGuard"]
): void {
  const notice = document.getElementById("permission-guard-notice")!;
  let anyVisible = false;
  for (const [kind, id] of Object.entries(PERMISSION_GUARD_LINK_IDS) as [
    keyof typeof PERMISSION_GUARD_LINK_IDS,
    string,
  ][]) {
    const link = document.getElementById(id) as HTMLAnchorElement;
    if (!guard[kind]) {
      link.hidden = true;
      continue;
    }
    link.hidden = false;
    anyVisible = true;
    link.onclick = (event) => {
      event.preventDefault();
      const message: AllowPermissionGuardOriginMessage = {
        type: "allow-permission-guard-origin",
        hostname,
        kind,
      };
      void browser.runtime.sendMessage(message);
      link.hidden = true;
    };
  }
  notice.hidden = !anyVisible;
}

async function render(): Promise<void> {
  const status = await getStatus();

  // Filter lists the browser's shared DNR budget forced off (another rule-
  // heavy extension is usually the cause) -- the options page already shows
  // the full detail + per-list badges; this is the one-line heads-up so it's
  // visible without opening Settings.
  if (status.droppedFilterGroups.length > 0) {
    document.getElementById("budget-notice")!.hidden = false;
  }

  document.getElementById("count")!.textContent = String(status.blockedOnTab);
  document.getElementById("count-ads")!.textContent = String(status.breakdown.ads);
  document.getElementById("count-trackers")!.textContent = String(status.breakdown.trackers);
  document.getElementById("count-popups")!.textContent = String(status.breakdown.popups);
  // A qualitative read over the same real count shown numerically above it,
  // not a new measurement -- see shared/protectionLevel.ts for why this
  // isn't a before/after "grade" the way DuckDuckGo's is (Moat has no
  // counterfactual "what this page would have loaded without protection").
  const level = protectionLevelForCount(status.blockedOnTab);
  document.getElementById("protection-level")!.textContent = getMessageOrFallback(
    (key) => browser.i18n.getMessage(key),
    PROTECTION_LEVEL_MESSAGE_KEY[level],
    ""
  );
  renderCompanyBreakdown(status.companyBreakdown);

  const hostnameEl = document.getElementById("hostname")!;
  const siteCard = document.getElementById("site-card")!;
  const toggle = document.getElementById("site-toggle") as HTMLInputElement;
  const stats = document.getElementById("stats")!;
  const pausedBanner = document.getElementById("paused-banner")!;
  const pausedHostname = document.getElementById("paused-hostname")!;
  const siteState = document.getElementById("site-state")!;
  const siteStateText = document.getElementById("site-state-text")!;
  const reloadButton = document.getElementById("reload-page") as HTMLButtonElement;
  const reportButton = document.getElementById("report-problem") as HTMLButtonElement;

  if (!status.hostname) {
    siteCard.style.display = "none";
    stats.hidden = false;
    return;
  }

  reportButton.hidden = false;
  hostnameEl.textContent = status.hostname;
  pausedHostname.textContent = status.hostname;
  renderPermissionGuardNotice(status.hostname, status.permissionGuard);
  void renderSiteOverrides(status.hostname).catch(() => {
    // Best-effort -- the core pause/protect toggle above still works fine
    // without this panel if the settings read fails.
  });
  toggle.checked = !status.siteDisabled;
  toggle.disabled = !status.enabled;

  function setPaused(paused: boolean): void {
    stats.hidden = paused;
    pausedBanner.hidden = !paused;
    reloadButton.hidden = !paused;
    siteState.classList.toggle("paused", paused);
    siteStateText.textContent = getMessageOrFallback(
      (key) => browser.i18n.getMessage(key),
      paused ? "popupPaused" : "popupProtected",
      paused ? "paused" : "protected"
    );
  }

  setPaused(status.siteDisabled || !status.enabled);

  toggle.addEventListener("change", () => {
    const disabled = !toggle.checked;
    const message: ToggleSiteMessage = { type: "toggle-site", hostname: status.hostname, disabled };
    void browser.runtime.sendMessage(message);
    setPaused(disabled || !status.enabled);
  });

  reloadButton.addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) await browser.tabs.reload(tab.id);
    window.close();
  });
}

for (const id of ["open-options", "budget-open-options"]) {
  document.getElementById(id)?.addEventListener("click", (event) => {
    event.preventDefault();
    void browser.runtime.openOptionsPage();
  });
}

document.getElementById("start-picker")?.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    const tabId = tab.id;
    try {
      await browser.tabs.sendMessage(tabId, { type: "start-picker" });
    } catch {
      // No content script listening yet -- element-picker.js only
      // auto-injects on page load, so a tab left open since before the
      // extension was last installed/reloaded has no receiver. Inject it on
      // demand and retry once. This still no-ops on pages content scripts
      // can never run on (chrome://, the Web Store), which reject the
      // injection the same way.
      try {
        await browser.scripting.executeScript({ target: { tabId }, files: ["element-picker.js"] });
        await browser.tabs.sendMessage(tabId, { type: "start-picker" });
      } catch {
        // Nothing more we can do here.
      }
    }
  }
  window.close();
});

document.getElementById("report-problem")?.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  try {
    const message: GetReportContextMessage = { type: "get-report-context" };
    const context = (await browser.runtime.sendMessage(message)) as ReportContextResponse;
    const url = buildIssueUrl(context, browser.runtime.getManifest().version);
    await browser.tabs.create({ url });
    window.close();
  } catch {
    // A dead click here (background unreachable, tab creation blocked)
    // otherwise leaves the user with zero feedback -- flash the failure
    // in place on the button they just pressed rather than staying silent.
    button.textContent = getMessageOrFallback(
      (key) => browser.i18n.getMessage(key),
      "popupReportError",
      "Couldn't open the report page. Try again."
    );
  }
});

void render().catch(() => {
  document.getElementById("site-card")!.textContent = getMessageOrFallback(
    (key) => browser.i18n.getMessage(key),
    "popupLoadError",
    "Couldn't load status. Try reopening the popup."
  );
});
void renderUiNotices().catch(() => {
  // Best-effort convenience cards (onboarding, "what's new") -- if the
  // background worker doesn't answer, the popup is still fully usable
  // without them, so there's nothing to surface to the user here.
});

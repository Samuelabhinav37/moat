import browser from "webextension-polyfill";
import { getEffectiveSettings, getSyncStatus } from "../background/settings";
import { getManagedPolicy, isLocked } from "../background/managedPolicy";
import { getLiveUpdateStatus, getYoutubeQuickFixesStatus } from "../background/liveUpdates";
import { getFilterGroupStatus } from "../background/filterGroups";
import { effectiveFilterGroupState } from "../background/filterGroupState";
import { isSupported as isCnameUncloakFirefoxSupported } from "../background/cnameUncloak";
import { isSupported as isCnameUncloakChromeSupported } from "../background/cnameUncloakChrome";
import { detectPreset, presetPatch, type PresetName } from "../shared/filterPresets";
import { summarizeFilterLists, type RulesetManifestEntry } from "../shared/rulesetManifest";
import { getUsageSummary } from "../background/usageStats";
import { getCustomRuleStats } from "../background/customRuleStats";
import { getLastBackupAt, recordBackupTaken } from "../background/backupStats";
import { dismissWelcome, shouldShowWelcome } from "../background/updateNotice";
import { customRuleStatKey, isStale } from "../shared/customRuleStats";
import { validateImportedSettings } from "../background/settingsPortability";
import { summarizeSettingsImport } from "../shared/settingsDiff";
import type {
  AddCustomDomainMessage,
  AddCustomDomainResponse,
  CheckForLiveUpdatesMessage,
  CompanyBreakdownResponse,
  CustomDomainListField,
  CustomRuleStat,
  ExportSettingsMessage,
  FilterListMatchesResponse,
  GetCompanyBreakdownMessage,
  GetFilterListMatchesMessage,
  ImportCustomRulesMessage,
  ImportCustomRulesResponse,
  ImportSettingsMessage,
  ImportSettingsResponse,
  RemoveCosmeticRuleMessage,
  RemoveCustomDomainMessage,
  RemoveGrayscaleRuleMessage,
  Settings,
  SettingsPatchField,
  SetSettingsPatchMessage,
  StartElementPickerMessage,
  StartElementPickerResponse,
  ToggleSiteMessage,
  UsageSignal,
  UsageSummaryResponse,
} from "../types";
import { joinCompanyBreakdown, type CompanyInfo } from "./trackerView";
import { applyStaticI18n, getMessageOrFallback } from "../shared/i18n";
import { parseFilterListImport } from "../shared/filterListImport";
import { MAX_STRING_LENGTH } from "../shared/importBounds";

// options.html is its own extension page -- a separate realm from the
// background worker, same as bridge.ts was before it started routing
// fingerprint-seed generation through a message instead of calling
// background/settings.ts's mutators directly. These wrappers keep every
// call site below unchanged (same names, same signatures) while actually
// sending the mutation to the one background realm every other settings
// change already goes through -- see SetSettingsPatchMessage's own comment
// in types.ts for why this matters: two realms each computing a change
// from their own separately-read "current settings" can silently discard
// one another's change when both write back.
async function setSettings(patch: Partial<Settings>): Promise<void> {
  const message: SetSettingsPatchMessage = { type: "set-settings-patch", patch };
  await browser.runtime.sendMessage(message);
}

async function setSiteDisabled(hostname: string, disabled: boolean): Promise<void> {
  const message: ToggleSiteMessage = { type: "toggle-site", hostname, disabled };
  await browser.runtime.sendMessage(message);
}

async function removeCustomCosmeticRule(hostname: string, selector: string): Promise<void> {
  const message: RemoveCosmeticRuleMessage = { type: "remove-cosmetic-rule", hostname, selector };
  await browser.runtime.sendMessage(message);
}

async function removeGrayscaleRule(hostname: string, selector: string): Promise<void> {
  const message: RemoveGrayscaleRuleMessage = { type: "remove-grayscale-rule", hostname, selector };
  await browser.runtime.sendMessage(message);
}

// The add/remove decision itself (is this hostname already in the list?)
// happens on the background side, inside the same mutateSettings call that
// writes it -- not here from a separately-read snapshot. See
// settings.ts's addCustomDomain/removeCustomDomain for why that matters
// even once the write itself is routed through the right realm: a
// replacement array computed from a stale read can still discard an
// unrelated concurrent change to the same list.
async function sendAddCustomDomain(field: CustomDomainListField, hostname: string): Promise<boolean> {
  const message: AddCustomDomainMessage = { type: "add-custom-domain", field, hostname };
  const response = (await browser.runtime.sendMessage(message)) as AddCustomDomainResponse;
  return response.ok;
}

async function sendRemoveCustomDomain(field: CustomDomainListField, hostname: string): Promise<void> {
  const message: RemoveCustomDomainMessage = { type: "remove-custom-domain", field, hostname };
  await browser.runtime.sendMessage(message);
}

function tFallback(key: string, fallback: string, substitutions?: string | string[]): string {
  return getMessageOrFallback((k, s) => browser.i18n.getMessage(k, s), key, fallback, substitutions);
}

applyStaticI18n(document, (key, subs) => browser.i18n.getMessage(key, subs));

// ---------- Advanced settings (expands in place) ----------

// One page: what most people change sits on the main panel, everything
// else opens in place under this button. A disclosure (aria-expanded +
// aria-controls), not tabs -- there is only ever one thing to reveal.
const advancedToggle = document.getElementById("advanced-toggle") as HTMLButtonElement;
const advancedToggleTitle = document.getElementById("advanced-toggle-title") as HTMLElement;
const advancedSection = document.getElementById("advanced") as HTMLElement;
const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function setAdvancedOpen(open: boolean): void {
  advancedToggle.setAttribute("aria-expanded", String(open));
  advancedToggleTitle.textContent = open
    ? tFallback("advancedButtonHide", "Hide advanced settings")
    : tFallback("advancedButton", "Advanced settings");
  advancedSection.hidden = !open;
  if (open) {
    document.getElementById("advanced-title")?.scrollIntoView?.({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }
}

advancedToggle.addEventListener("click", () => {
  setAdvancedOpen(advancedToggle.getAttribute("aria-expanded") !== "true");
});

// The per-tab tracker breakdown is fetched lazily, only once its own
// disclosure is opened (it reads the last active tab's match data).
document.getElementById("trackers-current")!.addEventListener("toggle", (event) => {
  if ((event.currentTarget as HTMLDetailsElement).open) void renderTrackers();
});

// ---------- Protection tab ----------

type ProtectionGroup = "privacy" | "annoyances" | "safety";

/** Which usage-summary field an "on" row's evidence line reads. "week" is
 * the default (a distinct-hostname count over the trailing 7 days); the
 * grayscale ad-dimmer only ever runs on YouTube, so a hostname count would
 * always read "1 site" -- it reads a daily event count instead. */
type EvidenceUnit = "week" | "today";

interface ProtectionDef {
  id: string;
  // SettingsPatchField, not the wider `keyof Settings`: this is the field a
  // click on this row's toggle actually writes, via setSettings ->
  // "set-settings-patch" -> pickAllowedSettingsPatch, which silently drops
  // any key not in SETTINGS_PATCH_ALLOWED_FIELDS with no error anywhere --
  // a toggle wired to a field that allow-list doesn't cover used to
  // typecheck fine and then just never persist (the checkbox visibly
  // reverts right after every click). Narrowing this to SettingsPatchField
  // makes that a compile error at the PROTECTIONS entry itself instead.
  settingKey: SettingsPatchField;
  group: ProtectionGroup;
  titleKey: readonly [string, string];
  descKey: readonly [string, string];
  cautionKey?: readonly [string, string];
  signal?: UsageSignal;
  metricLabelKey?: readonly [string, string];
  evidenceUnit?: EvidenceUnit;
  /** Only rendered when browser.privacy.websites exposes the Firefox-only
   * BrowserSettings this row's settingKey maps to -- see
   * isFirefoxPrivacyWebsitesSupported below. A toggle that would silently do
   * nothing on Chrome (that API surface doesn't exist there at all) is worse
   * than not showing it. */
  firefoxOnly?: boolean;
}

// Real, per-protection evidence only exists for the mechanisms with an
// actual enforcement-time hook to report from (see background/usageStats.ts
// and the surface-redesign plan's achievability table) -- blockThirdPartyCookies,
// webrtcLeakProtection, and the permission-guard trio apply through global
// browser APIs with no per-request/per-origin feedback at all, so they carry
// no `signal` and their rows never show an evidence line, on or off.
const PROTECTIONS: ProtectionDef[] = [
  {
    id: "cookies",
    settingKey: "blockThirdPartyCookies",
    group: "privacy",
    titleKey: ["optionsCookiesToggleLabel", "Stop sites tracking you across the web"],
    descKey: [
      "optionsCookiesToggleHint",
      "Stops sites from tracking you as you move from one to the next (blocks third-party cookies).",
    ],
  },
  {
    id: "webrtc",
    settingKey: "webrtcLeakProtection",
    group: "privacy",
    titleKey: ["optionsWebrtcToggleLabel", "Stop IP address leaks"],
    descKey: [
      "optionsWebrtcToggleHint",
      "Keeps a website from seeing your real IP address if you're using a VPN.",
    ],
  },
  {
    id: "fingerprint",
    settingKey: "fingerprintResistance",
    group: "privacy",
    signal: "fingerprint",
    evidenceUnit: "week",
    titleKey: ["optionsFingerprintToggleLabel", "Stop sites recognizing your device"],
    descKey: [
      "optionsFingerprintDrawerDesc",
      "Randomly tweaks details about your device that sites use to recognize you across visits.",
    ],
    cautionKey: [
      "optionsFingerprintCaution",
      "Can occasionally break a CAPTCHA or a bank's device check. If a site misbehaves, pause this first.",
    ],
    metricLabelKey: ["optionsFingerprintMetricLabel", "sites randomised this week"],
  },
  {
    id: "cname",
    settingKey: "cnameUncloaking",
    group: "privacy",
    signal: "cnameUncloak",
    evidenceUnit: "week",
    titleKey: ["optionsCnameToggleLabel", "Catch trackers hiding in disguise"],
    descKey: [
      "optionsCnameDrawerDesc",
      "Some trackers disguise themselves as part of the site you're visiting.",
    ],
    metricLabelKey: ["optionsCnameMetricLabel", "sites protected this week"],
  },
  {
    id: "firefoxResistFingerprinting",
    settingKey: "firefoxResistFingerprinting",
    group: "privacy",
    firefoxOnly: true,
    titleKey: ["optionsFirefoxRFPToggleLabel", "Use Firefox's own device-disguise mode"],
    descKey: [
      "optionsFirefoxRFPToggleHint",
      "Turns on a deeper device-disguise mode built into Firefox itself. It reaches further than Moat can on its own: window size, fonts, timezone, and more.",
    ],
    cautionKey: [
      "optionsFirefoxRFPCaution",
      "Can be more disruptive than Moat's own fingerprint protection above. It changes real browser behavior, not just what a page can see, so it's worth trying for a few days before relying on it.",
    ],
  },
  {
    id: "firefoxFirstPartyIsolate",
    settingKey: "firefoxFirstPartyIsolate",
    group: "privacy",
    firefoxOnly: true,
    titleKey: ["optionsFirefoxFPIToggleLabel", "Stop trackers linking you across sites"],
    descKey: [
      "optionsFirefoxFPIToggleHint",
      "Keeps every site's stored data separate, so the same tracker embedded on two different sites can't connect what it saw on each.",
    ],
    cautionKey: [
      "optionsFirefoxFPICaution",
      "Can break logging in with a Google or Facebook account on a third-party site. If a login stops working, pause this first.",
    ],
  },
  {
    id: "grayscale",
    settingKey: "grayscaleUnblockableAds",
    group: "annoyances",
    signal: "grayscaleAds",
    evidenceUnit: "today",
    titleKey: ["optionsGrayscaleToggleLabel", "Gray out unblockable video ads"],
    descKey: [
      "optionsGrayscaleToggleHint",
      "Fades in-stream video ads, like YouTube's, to grayscale while they play.",
    ],
    metricLabelKey: ["optionsGrayscaleMetricLabel", "ads dimmed today"],
  },
  {
    id: "feedScan",
    settingKey: "aggressiveFeedAdRemoval",
    group: "annoyances",
    signal: "feedAdRemoval",
    evidenceUnit: "week",
    titleKey: ["optionsFeedScanToggleLabel", "Hide sponsored posts in feeds"],
    descKey: [
      "optionsFeedScanToggleHint",
      "Removes sponsored and promoted posts from Instagram, LinkedIn, and YouTube as you scroll.",
    ],
    metricLabelKey: ["optionsFeedScanMetricLabel", "posts hidden this week"],
  },
  {
    id: "consentReject",
    settingKey: "cookieBannerAutoReject",
    group: "annoyances",
    signal: "cookieBannerReject",
    evidenceUnit: "week",
    titleKey: ["optionsConsentRejectToggleLabel", "Auto-reject cookie banners"],
    descKey: ["optionsConsentRejectToggleHint", "Clicks “reject” or “decline” on common consent banners for you."],
    metricLabelKey: ["optionsConsentRejectMetricLabel", "banners rejected this week"],
  },
  {
    id: "searchSlop",
    settingKey: "hideSeoSpamResults",
    group: "annoyances",
    signal: "searchSlop",
    evidenceUnit: "week",
    titleKey: ["optionsSearchSlopToggleLabel", "Hide low-quality search results"],
    descKey: [
      "optionsSearchSlopDrawerDesc",
      "Hides search results that match a small, curated list of content-farm domains.",
    ],
    cautionKey: [
      "optionsSearchSlopCaution",
      "Each hidden batch stays one click away behind a \"Show\" link. Off by default, since this list can misfire in ways a fixed ad-network list won't.",
    ],
    metricLabelKey: ["optionsSearchSlopMetricLabel", "results hidden this week"],
  },
  {
    id: "leakedPassword",
    settingKey: "leakedPasswordCheck",
    group: "safety",
    signal: "leakedPasswordCheck",
    evidenceUnit: "week",
    titleKey: ["optionsLeakedPasswordToggleLabel", "Check passwords against known breaches"],
    descKey: ["optionsLeakedPasswordDrawerDesc", "Warns if a password you type has appeared in a known breach."],
    cautionKey: ["optionsLeakedPasswordCaution", "Only a short piece of its hash ever leaves your device."],
    metricLabelKey: ["optionsLeakedPasswordMetricLabel", "passwords checked this week"],
  },
];

// browser.privacy.websites.resistFingerprinting/firstPartyIsolate are real
// BrowserSettings on Firefox and simply don't exist on Chrome (see
// background/privacySettings.ts) -- checked once here rather than per-render,
// since which browser this is doesn't change during a session.
const isFirefoxPrivacyWebsitesSupported = typeof browser.privacy?.websites?.resistFingerprinting !== "undefined";
const VISIBLE_PROTECTIONS = PROTECTIONS.filter((def) => !def.firefoxOnly || isFirefoxPrivacyWebsitesSupported);

const SVG_NS_ICON = "http://www.w3.org/2000/svg";

// The four extras people change most sit on the main panel; every other
// protection row lives under Advanced settings -> Privacy extras.
const FEATURE_IDS = ["consentReject", "grayscale", "feedScan", "leakedPassword"] as const;

// 24x24 line icons, one per setting row. Built with createElementNS, never
// innerHTML: web-ext lint flags any innerHTML assignment it can't prove is
// a literal, even a safe hardcoded one.
const ICON_PATHS: Record<string, string[]> = {
  consentReject: [
    "M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5a3 3 0 0 0 4 3.8 3 3 0 0 0 5 5.2Z",
    "M9 10h.01M13.5 15h.01M8.5 15h.01",
  ],
  grayscale: ["M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "m10 9 5 3-5 3V9Z"],
  feedScan: ["M5.5 4h13A1.5 1.5 0 0 1 20 5.5v3A1.5 1.5 0 0 1 18.5 10h-13A1.5 1.5 0 0 1 4 8.5v-3A1.5 1.5 0 0 1 5.5 4ZM5.5 14h13a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-3A1.5 1.5 0 0 1 5.5 14Z"],
  leakedPassword: ["M7 10h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z", "M8 10V7.5a4 4 0 0 1 8 0V10"],
  cookies: ["M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M4 20 20 4"],
  webrtc: ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z", "M3.5 12h17M12 3.5c2.5 2.3 3.5 5.2 3.5 8.5s-1 6.2-3.5 8.5c-2.5-2.3-3.5-5.2-3.5-8.5s1-6.2 3.5-8.5Z"],
  fingerprint: ["M12 11c0 3-1 6-3 8M8 6.5A6 6 0 0 1 18 11c0 2-.3 4-1 6M6 10a6 6 0 0 1 .5-2.5M12 11c0-1 .5-2 2-2M5.5 14c.3 1 .3 2-.5 3"],
  cname: ["M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z", "m16 16 4.5 4.5"],
  firefoxResistFingerprinting: ["M12 11c0 3-1 6-3 8M8 6.5A6 6 0 0 1 18 11c0 2-.3 4-1 6M6 10a6 6 0 0 1 .5-2.5"],
  firefoxFirstPartyIsolate: ["M4 5h7v14H4zM13 5h7v14h-7z"],
  searchSlop: ["M5 7h14M5 12h9M5 17h6"],
  permissionGuard: ["M5 7h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z", "m15 11 6-3v8l-6-3"],
  list: ["M5 7h14M5 12h14M5 17h14"],
};

function buildIcon(name: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "setting-icon";
  wrap.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG_NS_ICON, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of ICON_PATHS[name] ?? ICON_PATHS.list!) {
    const path = document.createElementNS(SVG_NS_ICON, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  wrap.append(svg);
  return wrap;
}

/** Icon, title, one line of description, then a switch -- the one row shape
 * every setting on this page uses. `extra` goes under the description
 * (cautions, evidence, chips). */
function buildSettingRow(options: {
  icon: string;
  titleId: string;
  title: string;
  desc?: string;
  on: boolean;
  extra?: HTMLElement[];
  control?: HTMLElement;
}): HTMLElement {
  const row = document.createElement("div");
  row.className = options.on ? "setting-row is-on" : "setting-row";
  const text = document.createElement("div");
  const title = document.createElement("span");
  title.className = "setting-title";
  title.id = options.titleId;
  title.textContent = options.title;
  text.append(title);
  if (options.desc) {
    const desc = document.createElement("span");
    desc.className = "setting-desc";
    desc.textContent = options.desc;
    text.append(desc);
  }
  if (options.extra) text.append(...options.extra);
  row.append(buildIcon(options.icon), text);
  if (options.control) row.append(options.control);
  return row;
}

function buildLine(className: string, textContent: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = textContent;
  return el;
}

// permission-guard is one merged row (three chips) sitting with the plain
// PROTECTIONS entries above, but its shape is different enough (three
// independent booleans, no single switch) that it isn't modeled as a
// ProtectionDef at all -- see buildPermissionGuardRow.
function isAnyPermissionGuardOn(settings: Settings): boolean {
  return settings.permissionGuardCamera || settings.permissionGuardMicrophone || settings.permissionGuardLocation;
}

const masterToggle = document.getElementById("master-toggle") as HTMLInputElement;
const protectionLockedBadge = document.getElementById("protection-locked-badge") as HTMLElement;
const masterStatusTitle = document.getElementById("master-status-title") as HTMLElement;
const featureRowsEl = document.getElementById("feature-rows") as HTMLElement;
const protectionGroupsEl = document.getElementById("protection-groups") as HTMLElement;

const cnameUnsupportedHint = tFallback("optionsCnameUnsupportedHint", "Not available in this browser.");
const cnameChromeDohHint = tFallback(
  "optionsCnameChromeDohHint",
  "On Chrome, this checks disguised trackers using Cloudflare's public lookup service. It may miss the very first one it finds, then catches every one after that. Firefox does this itself, more privately, and catches every one from the start."
);

const liveStatus = document.getElementById("live-status") as HTMLElement | null;
const siteList = document.getElementById("site-list") as HTMLUListElement;
const siteEmptyState = document.getElementById("site-empty-state") as HTMLElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const addButton = document.getElementById("add-button") as HTMLButtonElement;

// Set by the top-level render() below; read by the import preview and the
// weekly tracker list so neither needs its own fetch.
let lastSettings: Settings | null = null;
let lastUsage: UsageSummaryResponse | null = null;

function renderSyncStatus(syncEnabled: boolean, status: Awaited<ReturnType<typeof getSyncStatus>>): void {
  const syncStatus = document.getElementById("sync-status") as HTMLElement;
  if (!syncEnabled || !status || status.ok) {
    syncStatus.hidden = true;
    return;
  }
  const when = new Date(status.when).toLocaleString();
  syncStatus.hidden = false;
  syncStatus.textContent = tFallback(
    "optionsSyncStatusFailed",
    `Couldn't sync your settings (${when}). You may have too many custom rules or sites for your ` +
      `browser's sync storage. They're still saved on this device.`,
    [when]
  );
}

function normalizeHostname(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_STRING_LENGTH) return null;
  try {
    // The URL parser itself enforces no length limit at all -- verified
    // directly: new URL("https://" + "a".repeat(50000)).hostname succeeds
    // and returns a 50,000-character "hostname". The trimmed.length check
    // above is the real bound; this one is redundant defense in depth on
    // whatever the parser hands back.
    const hostname = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
    return hostname.length > 0 && hostname.length <= MAX_STRING_LENGTH ? hostname : null;
  } catch {
    return null;
  }
}

/** Shared by every removable list on this page: the paused-sites list, the
 * two custom block/allow lists, and the picker's two saved-rule lists.
 * rerenderSelf re-renders just this one list after a removal -- adding or
 * removing one entry doesn't need to tear down and rebuild every other
 * list plus the filter-groups checkboxes on the page too, which is what
 * calling the page-level render() here would do. */
function renderRows<T>(
  list: HTMLUListElement,
  emptyState: HTMLElement,
  items: T[],
  formatLabel: (item: T) => string,
  removeLabel: string,
  onRemove: (item: T) => Promise<unknown>,
  rerenderSelf: () => Promise<void>
): void {
  emptyState.style.display = items.length ? "none" : "block";
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = formatLabel(item);

      const remove = document.createElement("button");
      remove.textContent = removeLabel;
      remove.addEventListener("click", async () => {
        await onRemove(item);
        await rerenderSelf();
      });

      li.append(label, remove);
      return li;
    })
  );
}

function renderDomainList(
  list: HTMLUListElement,
  emptyState: HTMLElement,
  domains: string[],
  removeLabel: string,
  onRemove: (domain: string) => Promise<void>,
  rerenderSelf: () => Promise<void>
): void {
  renderRows(list, emptyState, [...domains].sort(), (domain) => domain, removeLabel, onRemove, rerenderSelf);
}

// ---------- Setting rows ----------

function evidenceTextFor(def: ProtectionDef, usage: UsageSummaryResponse): string | null {
  if (!def.signal) return null;
  const summary = usage.bySignal[def.signal];
  if (!summary) return null;

  if (def.evidenceUnit === "today") {
    if (def.id === "grayscale") {
      if (summary.todayCount === 0) return null;
      return tFallback("optionsGrayscaleEvidenceToday", `${summary.todayCount} ads dimmed today`, String(summary.todayCount));
    }
    if (summary.todayHostnameCount === 0) return null;
    return tFallback("optionsProtectionEvidenceToday", `${summary.todayHostnameCount} sites today`, String(summary.todayHostnameCount));
  }

  if (summary.weekHostnameCount === 0) return null;
  return tFallback("optionsProtectionEvidenceWeek", `${summary.weekHostnameCount} sites this week`, String(summary.weekHostnameCount));
}

function buildSwitch(checked: boolean, labelledBy: string, onChange: (checked: boolean) => void): HTMLLabelElement {
  const toggle = document.createElement("label");
  toggle.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("aria-labelledby", labelledBy);
  const track = document.createElement("span");
  track.className = "track";
  track.innerHTML = '<span class="thumb"></span>';
  toggle.append(input, track);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => onChange(input.checked));
  return toggle;
}

function buildProtectionRow(def: ProtectionDef, settings: Settings, usage: UsageSummaryResponse): HTMLElement {
  const checked = Boolean(settings[def.settingKey]);
  const titleId = `protection-${def.id}-label`;
  const extra: HTMLElement[] = [];

  // What used to hide in a side drawer is shown inline: the caution (amber)
  // and, for the CNAME row, how well it works in this browser.
  if (def.id === "cname") {
    const firefoxSupported = isCnameUncloakFirefoxSupported();
    const chromeSupported = isCnameUncloakChromeSupported();
    if (!firefoxSupported && !chromeSupported) extra.push(buildLine("setting-caution", cnameUnsupportedHint));
    else if (chromeSupported) extra.push(buildLine("setting-desc", cnameChromeDohHint));
  }
  if (def.cautionKey) extra.push(buildLine("setting-caution", tFallback(...def.cautionKey)));
  if (checked) {
    const evidence = evidenceTextFor(def, usage);
    if (evidence) extra.push(buildLine("setting-evidence", evidence));
  }

  const control = buildSwitch(checked, titleId, (next) => {
    if (next) row.classList.add("pop");
    void setSettings({ [def.settingKey]: next } as Partial<Pick<Settings, SettingsPatchField>>).then(() => render());
  });
  const row = buildSettingRow({
    icon: def.id,
    titleId,
    title: tFallback(...def.titleKey),
    desc: tFallback(...def.descKey),
    on: checked,
    extra,
    control,
  });
  return row;
}

function buildFingerprintRotateRow(settings: Settings): HTMLElement {
  const row = document.createElement("div");
  row.className = "setting-subrow";
  const title = document.createElement("span");
  title.id = "fingerprint-rotate-toggle-label";
  title.textContent = tFallback("optionsFingerprintRotateToggleLabel", "Use a new disguise each time you restart");
  const toggle = buildSwitch(settings.fingerprintRotatePerSession, title.id, (next) => {
    void setSettings({ fingerprintRotatePerSession: next }).then(() => render());
  });
  row.append(title, toggle);
  return row;
}

function buildPermissionGuardRow(settings: Settings): HTMLElement {
  const chips = document.createElement("div");
  chips.className = "permission-chips";
  const kinds = [
    { key: "permissionGuardCamera", labelKey: ["optionsChipCameraLabel", "Camera"] },
    { key: "permissionGuardMicrophone", labelKey: ["optionsChipMicrophoneLabel", "Microphone"] },
    { key: "permissionGuardLocation", labelKey: ["optionsChipLocationLabel", "Location"] },
  ] as const;
  for (const kind of kinds) {
    const on = Boolean(settings[kind.key]);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = on ? "chip on" : "chip";
    chip.setAttribute("aria-pressed", String(on));
    chip.textContent = tFallback(kind.labelKey[0], kind.labelKey[1]);
    chip.addEventListener("click", () => {
      void setSettings({ [kind.key]: !on } as Partial<Pick<Settings, SettingsPatchField>>).then(() => render());
    });
    chips.append(chip);
  }
  return buildSettingRow({
    icon: "permissionGuard",
    titleId: "protection-permissionGuard-label",
    title: tFallback("optionsPermissionGuardMergedLabel", "Block surprise permission requests"),
    desc: tFallback(
      "optionsPermissionGuardMergedDesc",
      "Stops pages asking for your camera, microphone or location the moment they load. Allow a site from the popup when you trust it."
    ),
    on: isAnyPermissionGuardOn(settings),
    extra: [chips],
  });
}

function renderProtectionGroups(settings: Settings, usage: UsageSummaryResponse): void {
  const isFeature = (def: ProtectionDef): boolean => (FEATURE_IDS as readonly string[]).includes(def.id);

  featureRowsEl.replaceChildren(
    ...FEATURE_IDS.map((id) => VISIBLE_PROTECTIONS.find((def) => def.id === id))
      .filter((def): def is ProtectionDef => def !== undefined)
      .map((def) => buildProtectionRow(def, settings, usage))
  );

  const advancedRows: HTMLElement[] = [];
  for (const def of VISIBLE_PROTECTIONS.filter((d) => !isFeature(d))) {
    advancedRows.push(buildProtectionRow(def, settings, usage));
    if (def.id === "fingerprint" && settings.fingerprintResistance) advancedRows.push(buildFingerprintRotateRow(settings));
  }
  advancedRows.push(buildPermissionGuardRow(settings));
  protectionGroupsEl.replaceChildren(...advancedRows);
}

async function renderProtectionTab(settings: Settings, policy: Awaited<ReturnType<typeof getManagedPolicy>>): Promise<void> {
  const protectionLocked = isLocked("protection", policy);
  masterToggle.checked = settings.enabled;
  masterToggle.disabled = protectionLocked;
  protectionLockedBadge.hidden = !protectionLocked;
  masterStatusTitle.textContent = settings.enabled
    ? tFallback("settingsStatusOn", "Moat is on")
    : tFallback("settingsStatusOff", "Moat is off");

  const usage = await getUsageSummary();
  lastSettings = settings;
  lastUsage = usage;

  document.getElementById("metric-blocked-today")!.textContent = usage.today.total.toLocaleString();
  renderProtectionGroups(settings, usage);
}

masterToggle.addEventListener("change", async () => {
  await setSettings({ enabled: masterToggle.checked });
  await render();
});

function renderLiveStatus(
  status: Awaited<ReturnType<typeof getLiveUpdateStatus>>,
  youtubeStatus?: Awaited<ReturnType<typeof getYoutubeQuickFixesStatus>>
): void {
  if (!liveStatus) return;
  if (!status) {
    liveStatus.textContent = tFallback("optionsLiveStatusNotChecked", "Not checked yet.");
    return;
  }
  const when = new Date(status.timestamp).toLocaleString();
  if (!status.ok) {
    liveStatus.textContent = tFallback(
      "optionsLiveStatusFailed",
      `Last attempt failed (${when}). Still using the built-in list until the next try.`,
      [when]
    );
    return;
  }
  let text = tFallback("optionsLiveStatusOk", `Last updated ${when} (${status.domainCount} domains).`, [
    when,
    String(status.domainCount),
  ]);
  if (status.quickFixCount) {
    text += tFallback("optionsLiveStatusQuickFixes", ` ${status.quickFixCount} extra fix(es) applied.`, [
      String(status.quickFixCount),
    ]);
  }
  if (status.cosmeticFixCount) {
    text += tFallback("optionsLiveStatusCosmeticFixes", ` ${status.cosmeticFixCount} layout fix(es) applied.`, [
      String(status.cosmeticFixCount),
    ]);
  }
  if (youtubeStatus?.ok && youtubeStatus.selectorCount) {
    text += tFallback(
      "optionsLiveStatusYoutubeFixes",
      ` ${youtubeStatus.selectorCount} YouTube fix(es) applied.`,
      [String(youtubeStatus.selectorCount)]
    );
  }
  liveStatus.textContent = text;
}

// ---------- Filter Lists tab ----------

const presetRow = document.getElementById("preset-row") as HTMLElement;
const presetHint = document.getElementById("preset-hint") as HTMLElement;
const filtersLockedBadge = document.getElementById("filters-locked-badge") as HTMLElement;
const filterListRows = document.getElementById("filter-list-rows") as HTMLElement;
const filterBudgetWarning = document.getElementById("filter-budget-warning") as HTMLElement;
const filterBudgetDetail = document.getElementById("filter-budget-detail") as HTMLElement;
const filterCheckUpdates = document.getElementById("filter-check-updates") as HTMLAnchorElement;

// Keyed by both the i18n message key and its English fallback (used via
// tFallback below) -- kept as one table so the two can't drift apart.
const PRESET_HINTS: Record<PresetName | "custom", { key: string; fallback: string }> = {
  off: { key: "presetHintOff", fallback: "Nothing is blocked." },
  lite: { key: "presetHintLite", fallback: "Like Essential, without the largest security list." },
  essential: { key: "presetHintEssential", fallback: "Ads, popups, and known-malicious sites." },
  standard: { key: "presetHintStandard", fallback: "Ads, trackers, and known-malicious sites." },
  strict: { key: "presetHintStrict", fallback: "Every list, plus all the Privacy extras." },
  custom: { key: "presetHintCustom", fallback: "A mix you've set up yourself." },
};

// Chrome's historical global cap on the sum of *enabled* static rules across
// every installed extension combined (declarativeNetRequest's shared
// budget) -- framing the "rules active" hero number against this is the
// only comparison that makes a six-figure number mean anything, and it's
// why lists can't all just stay on forever. Not the same number as
// getAvailableStaticRuleCount()'s live remaining-budget figure below, which
// also accounts for every *other* extension's own usage.
const CHROME_GLOBAL_STATIC_RULE_LIMIT = 330_000;

let manifestCache: RulesetManifestEntry[] | null = null;

/** Returns null (rather than throwing) on a corrupted install or any other
 * fetch/parse failure, so a single bad read here doesn't take down the rest
 * of render() -- see renderFilterLists's null check below. */
async function loadRulesetManifest(): Promise<RulesetManifestEntry[] | null> {
  if (manifestCache) return manifestCache;
  try {
    const url = browser.runtime.getURL("rules/manifest.json");
    manifestCache = (await (await fetch(url)).json()) as RulesetManifestEntry[];
    return manifestCache;
  } catch {
    return null;
  }
}

// Read by the About section's "rules" line so both places always show the
// same number.
let activeRuleCountText = "—";

function renderFilterBudget(settings: Settings, lists: ReturnType<typeof summarizeFilterLists>): void {
  const state = effectiveFilterGroupState(
    settings.enabled,
    settings.filterGroups,
    lists.map((list) => list.group)
  );
  const activeRuleCount = lists.filter((list) => state[list.group]).reduce((sum, list) => sum + list.ruleCount, 0);
  activeRuleCountText = activeRuleCount.toLocaleString();

  document.getElementById("filters-budget-line")!.textContent = tFallback(
    "advBudgetLine",
    `Chrome lets all your extensions use ${CHROME_GLOBAL_STATIC_RULE_LIMIT.toLocaleString()} blocking rules in total. Moat is using ${activeRuleCountText}.`,
    [CHROME_GLOBAL_STATIC_RULE_LIMIT.toLocaleString(), activeRuleCountText]
  );
  const percent = Math.min(100, Math.round((activeRuleCount / CHROME_GLOBAL_STATIC_RULE_LIMIT) * 100));
  const fill = document.getElementById("filters-budget-fill") as HTMLElement;
  fill.style.width = `${percent}%`;
  fill.className = percent >= 90 ? "budget-bar-fill caution" : "budget-bar-fill";
  document.getElementById("filters-budget-caption")!.textContent = tFallback(
    "optionsBudgetPercentUsed",
    `${percent}% of budget used`,
    String(percent)
  );
}

/** Updated synchronously (before any await) on every checkbox change below,
 * so two filter-list toggles fired in quick succession each merge onto the
 * other's already-applied change instead of racing two independent
 * getSettings() reads and clobbering one write with the other. */
let currentFilterGroups: Settings["filterGroups"] | null = null;

// The three presets offered on the main panel. Essential and a hand-picked
// mix ("custom") stay reachable from Advanced settings -> Filter lists; when
// one of those is active, no card is selected and a note says where to go.
const MAIN_LEVELS = ["lite", "standard", "strict"] as const;
const levelCards = document.querySelectorAll<HTMLButtonElement>("#level-cards .level");
const levelNote = document.getElementById("level-note") as HTMLElement;

function renderLevels(preset: PresetName | "custom", locked: boolean): void {
  for (const card of levelCards) {
    card.setAttribute("aria-checked", String(card.dataset.level === preset));
    card.disabled = locked;
  }
  levelNote.hidden = (MAIN_LEVELS as readonly string[]).includes(preset) || preset === "off";
}

for (const card of levelCards) {
  card.addEventListener("click", async () => {
    await setSettings(presetPatch(card.dataset.level as PresetName));
    await render();
  });
}

async function renderFilterLists(settings: Settings, droppedGroups: Set<string>): Promise<void> {
  const manifest = await loadRulesetManifest();
  if (!manifest) {
    const loadError = tFallback("optionsLoadListsError", "Couldn't load filter lists.");
    presetHint.textContent = loadError;
    const error = document.createElement("p");
    error.className = "empty-state";
    error.textContent = loadError;
    filterListRows.replaceChildren(error);
    return;
  }
  const lists = summarizeFilterLists(manifest);
  currentFilterGroups = settings.filterGroups;

  const preset = detectPreset(settings);
  presetHint.textContent = tFallback(PRESET_HINTS[preset].key, PRESET_HINTS[preset].fallback);
  for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
  }

  renderFilterBudget(settings, lists);

  const matchesMessage: GetFilterListMatchesMessage = { type: "get-filter-list-matches" };
  const matches = (await browser.runtime.sendMessage(matchesMessage)) as FilterListMatchesResponse;

  filterListRows.replaceChildren(
    ...lists
      .sort((a, b) => b.ruleCount - a.ruleCount)
      .map((list) => {
        const titleId = `filter-list-${list.group}-label`;
        const matchCount = matches.matchesByGroup[list.group] ?? 0;
        const countText = tFallback("optionsRuleCount", `${list.ruleCount.toLocaleString()} rules`, list.ruleCount.toLocaleString());
        const matchedSuffix =
          matchCount > 0 ? tFallback("optionsFilterMatchedOnPage", ` · matched ${matchCount} times on this page`, String(matchCount)) : "";
        const extra: HTMLElement[] = [];
        // The toggle reflects what the user *asked for* (settings.filterGroups),
        // which isn't necessarily what's enabled in Chrome right now -- a list
        // the shared rule budget kept off gets a visible badge on its own row
        // (see applyFilterGroupState's drop-priority retry in
        // background/filterGroups.ts).
        if (droppedGroups.has(list.group)) {
          extra.push(buildLine("locked-badge budget-badge", tFallback("optionsFilterBudgetDroppedBadge", "Not active (browser limit reached)")));
        }
        const on = settings.filterGroups[list.group] ?? true;
        const control = buildSwitch(on, titleId, (checked) => {
          const updated = { ...(currentFilterGroups ?? settings.filterGroups), [list.group]: checked };
          currentFilterGroups = updated;
          void setSettings({ filterGroups: updated }).then(() => render());
        });
        return buildSettingRow({ icon: "list", titleId, title: list.name, desc: countText + matchedSuffix, on, extra, control });
      })
  );
}

for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", async () => {
    await setSettings(presetPatch(button.dataset.preset as PresetName));
    await render();
  });
}

filterCheckUpdates.addEventListener("click", (event) => {
  event.preventDefault();
  const message: CheckForLiveUpdatesMessage = { type: "check-for-live-updates" };
  void browser.runtime.sendMessage(message).then(() => render());
});

// ---------- Custom Rules tab ----------

const customBlockList = document.getElementById("custom-block-list") as HTMLUListElement;
const customBlockEmpty = document.getElementById("custom-block-empty") as HTMLElement;
const customBlockInput = document.getElementById("custom-block-input") as HTMLInputElement;
const customBlockAdd = document.getElementById("custom-block-add") as HTMLButtonElement;
const customBlockAddStatus = document.getElementById("custom-block-add-status") as HTMLElement;

const customAllowList = document.getElementById("custom-allow-list") as HTMLUListElement;
const customAllowEmpty = document.getElementById("custom-allow-empty") as HTMLElement;
const customAllowInput = document.getElementById("custom-allow-input") as HTMLInputElement;
const customAllowAdd = document.getElementById("custom-allow-add") as HTMLButtonElement;
const customAllowAddStatus = document.getElementById("custom-allow-add-status") as HTMLElement;

// Both a locally-invalid hostname (empty, unparseable, or over
// MAX_STRING_LENGTH -- see normalizeHostname) and a background rejection
// (sendAddCustomDomain's { ok: false }) used to look identical to success:
// the input cleared and the list re-rendered either way, with the domain
// silently never added. Now both paths leave the input untouched and show
// a real reason instead.
async function addCustomDomain(field: CustomDomainListField, input: HTMLInputElement): Promise<void> {
  const status = field === "customBlockedDomains" ? customBlockAddStatus : customAllowAddStatus;
  const hostname = normalizeHostname(input.value);
  if (!hostname) {
    status.hidden = false;
    status.textContent = tFallback("optionsAddDomainInvalid", "That doesn't look like a valid domain.");
    return;
  }
  const ok = await sendAddCustomDomain(field, hostname);
  if (!ok) {
    status.hidden = false;
    status.textContent = tFallback("optionsAddDomainFailed", "Couldn't add that domain. Try again.");
    return;
  }
  status.hidden = true;
  input.value = "";
  await (field === "customBlockedDomains" ? rerenderCustomBlockList() : rerenderCustomAllowList());
}

customBlockAdd.addEventListener("click", () => addCustomDomain("customBlockedDomains", customBlockInput));
customBlockInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") customBlockAdd.click();
});

customAllowAdd.addEventListener("click", () => addCustomDomain("customAllowedDomains", customAllowInput));
customAllowInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") customAllowAdd.click();
});

const hiddenElementRows = document.getElementById("hidden-element-rows") as HTMLElement;
const hiddenElementEmpty = document.getElementById("hidden-element-empty") as HTMLElement;
const grayscaleElementRows = document.getElementById("grayscale-element-rows") as HTMLElement;
const grayscaleElementEmpty = document.getElementById("grayscale-element-empty") as HTMLElement;
const grayscaleElementBlock = document.getElementById("grayscale-element-block") as HTMLElement;
const pickElementButton = document.getElementById("pick-element-button") as HTMLButtonElement;
const pickElementStatus = document.getElementById("pick-element-status") as HTMLElement;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Built via the DOM rather than an innerHTML template -- web-ext lint flags
 * any innerHTML assignment it can't statically prove is a literal, even a
 * safe hardcoded one, as UNSAFE_VAR_ASSIGNMENT. */
function buildStaleTriangleIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.4");

  const outline = document.createElementNS(SVG_NS, "path");
  outline.setAttribute("d", "M8 1.5l7 12.5H1z");
  outline.setAttribute("stroke-linejoin", "round");

  const stem = document.createElementNS(SVG_NS, "path");
  stem.setAttribute("d", "M8 6.2v3.4");
  stem.setAttribute("stroke-linecap", "round");

  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", "8");
  dot.setAttribute("cy", "11.6");
  dot.setAttribute("r", "0.7");
  dot.setAttribute("fill", "currentColor");
  dot.setAttribute("stroke", "none");

  icon.append(outline, stem, dot);
  return icon;
}

/** Shared by the picker's "Hide" and "Gray out" saved-rule lists -- both are
 * hostname -> selector[] maps, joined against customRuleStats.ts's separate
 * per-rule hit/staleness store (see the surface-redesign plan) keyed the
 * same way that module stores entries. */
function buildRuleRow(
  kind: "hide" | "gray",
  hostname: string,
  selector: string,
  stats: Record<string, CustomRuleStat>,
  onRemove: (hostname: string, selector: string) => Promise<unknown>,
  rerenderSelf: () => Promise<void>
): HTMLElement {
  const now = Date.now();
  const stat = stats[customRuleStatKey(kind, hostname, selector)];
  const stale = stat ? isStale(stat, now) : false;

  const row = document.createElement("div");
  row.className = "rule-row";

  const main = document.createElement("div");
  main.className = "rule-main";
  const selectorEl = document.createElement("span");
  selectorEl.className = stale ? "rule-selector stale" : "rule-selector";
  selectorEl.textContent = selector;
  const siteEl = document.createElement("span");
  siteEl.className = "rule-site";
  siteEl.textContent = hostname;
  main.append(selectorEl, siteEl);

  const meta = document.createElement("div");
  meta.className = "rule-meta";
  if (stale) {
    meta.append(
      buildStaleTriangleIcon(),
      document.createTextNode(
        tFallback("optionsRuleStaleMeta", "Hasn't matched in 30 days. The site probably changed.")
      )
    );
  } else if (stat) {
    const days = Math.max(0, Math.floor((now - stat.createdAt) / 86_400_000));
    meta.textContent = tFallback(
      "optionsRuleAddedMeta",
      `Added ${days} days ago · hidden ${stat.hitCount} times since`,
      [String(days), String(stat.hitCount)]
    );
  }
  if (stale || stat) main.append(meta);

  // Stale-rule removal is immediate with no confirm dialog -- the rule is
  // already doing nothing, so there's nothing a confirm step would protect
  // against.
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = stale ? "rule-remove stale-remove" : "rule-remove";
  remove.textContent = tFallback("commonRemove", "Remove");
  remove.addEventListener("click", async () => {
    await onRemove(hostname, selector);
    await rerenderSelf();
  });

  row.append(main, remove);
  return row;
}

function renderRuleGroup(
  kind: "hide" | "gray",
  container: HTMLElement,
  emptyState: HTMLElement,
  rules: Record<string, string[]>,
  stats: Record<string, CustomRuleStat>,
  onRemove: (hostname: string, selector: string) => Promise<unknown>,
  rerenderSelf: () => Promise<void>
): void {
  const rows = Object.entries(rules)
    .flatMap(([hostname, selectors]) => selectors.map((selector) => ({ hostname, selector })))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
  emptyState.style.display = rows.length ? "none" : "block";
  container.replaceChildren(...rows.map((r) => buildRuleRow(kind, r.hostname, r.selector, stats, onRemove, rerenderSelf)));
}

pickElementButton.addEventListener("click", async () => {
  pickElementStatus.hidden = true;
  const message: StartElementPickerMessage = { type: "start-element-picker" };
  const result = (await browser.runtime.sendMessage(message)) as StartElementPickerResponse;
  if (!result.ok) {
    pickElementStatus.hidden = false;
    pickElementStatus.textContent = tFallback("optionsPickElementFailed", "Couldn't start the picker there.");
  }
});

// ---------- Custom Rules tab: migration import ----------

const migrationImportTextarea = document.getElementById("migration-import-textarea") as HTMLTextAreaElement;
const migrationImportFileButton = document.getElementById("migration-import-file-button") as HTMLButtonElement;
const migrationImportFileInput = document.getElementById("migration-import-file-input") as HTMLInputElement;
const migrationImportButton = document.getElementById("migration-import-button") as HTMLButtonElement;
const migrationImportStatus = document.getElementById("migration-import-status") as HTMLElement;

migrationImportFileButton.addEventListener("click", () => migrationImportFileInput.click());

migrationImportFileInput.addEventListener("change", async () => {
  const file = migrationImportFileInput.files?.[0];
  if (!file) return;
  migrationImportTextarea.value = await file.text();
  migrationImportFileInput.value = "";
});

/** Only the clauses with a non-zero count appear -- "0 blocked domains"
 * would read as noise, not information. */
function summarizeImportResult(response: ImportCustomRulesResponse, skippedLines: number): string {
  const parts: string[] = [];
  if (response.addedBlockedDomains > 0) {
    parts.push(
      tFallback("optionsMigrationImportBlocked", `${response.addedBlockedDomains} blocked domain(s)`, String(response.addedBlockedDomains))
    );
  }
  if (response.addedAllowedDomains > 0) {
    parts.push(
      tFallback("optionsMigrationImportAllowed", `${response.addedAllowedDomains} allowed domain(s)`, String(response.addedAllowedDomains))
    );
  }
  if (response.addedCosmeticRules > 0) {
    parts.push(
      tFallback("optionsMigrationImportCosmetic", `${response.addedCosmeticRules} element-hiding rule(s)`, String(response.addedCosmeticRules))
    );
  }
  const added =
    parts.length > 0
      ? tFallback("optionsMigrationImportAdded", `Added ${parts.join(", ")}.`, parts.join(", "))
      : tFallback("optionsMigrationImportNothingNew", "Nothing new to add -- every recognized rule was already saved.");
  const skipped =
    skippedLines > 0
      ? " " + tFallback("optionsMigrationImportSkipped", `${skippedLines} line(s) skipped (unsupported syntax).`, String(skippedLines))
      : "";
  return added + skipped;
}

migrationImportButton.addEventListener("click", async () => {
  const parsed = parseFilterListImport(migrationImportTextarea.value);
  migrationImportStatus.hidden = false;
  if (parsed.blockedDomains.length === 0 && parsed.allowedDomains.length === 0 && Object.keys(parsed.cosmeticRules).length === 0) {
    migrationImportStatus.textContent = tFallback("optionsMigrationImportNothingFound", "Nothing recognized in that text.");
    return;
  }
  const message: ImportCustomRulesMessage = {
    type: "import-custom-rules",
    blockedDomains: parsed.blockedDomains,
    allowedDomains: parsed.allowedDomains,
    cosmeticRules: parsed.cosmeticRules,
  };
  const response = (await browser.runtime.sendMessage(message)) as ImportCustomRulesResponse;
  migrationImportStatus.textContent = summarizeImportResult(response, parsed.skippedLines);
  migrationImportTextarea.value = "";
  await Promise.all([rerenderCustomBlockList(), rerenderCustomAllowList(), rerenderHiddenElementList()]);
});

// ---------- About tab (DR-13) ----------

const managedNotice = document.getElementById("managed-notice") as HTMLElement;
const versionNumberEl = document.getElementById("version-number") as HTMLElement;
const versionBuildEl = document.getElementById("version-build") as HTMLElement;
const versionRulesEl = document.getElementById("version-rules") as HTMLElement;
const versionUpdatedEl = document.getElementById("version-updated") as HTMLElement;
const disclosureSyncRecipientEl = document.getElementById("disclosure-sync-recipient") as HTMLElement;

// Feature-detected at runtime, not build-injected -- this build has no
// compile-time "which browser is this" constant (see
// isFirefoxPrivacyWebsitesSupported above, computed the same way). Whoever
// actually owns the browser's own sync account is who receives synced
// settings -- must never read "Google" on a Firefox build or vice versa:
// DR-15 treats a wrong recipient here as a privacy-disclosure bug, not a
// cosmetic one.
const SYNC_VENDOR_NAME = isFirefoxPrivacyWebsitesSupported ? tFallback("commonMozilla", "Mozilla") : tFallback("commonGoogle", "Google");

async function renderAboutTab(policy: Awaited<ReturnType<typeof getManagedPolicy>>): Promise<void> {
  const manifest = browser.runtime.getManifest();
  versionNumberEl.textContent = manifest.version;
  versionBuildEl.textContent = isFirefoxPrivacyWebsitesSupported ? tFallback("commonFirefox", "Firefox") : tFallback("commonChrome", "Chrome");
  // Same number the Filter lists budget line shows -- render() computes it
  // before this runs, so the two can never disagree.
  versionRulesEl.textContent = activeRuleCountText;
  const liveUpdateStatus = await getLiveUpdateStatus();
  versionUpdatedEl.textContent = liveUpdateStatus
    ? new Date(liveUpdateStatus.timestamp).toLocaleDateString()
    : tFallback("commonNever", "Never");

  disclosureSyncRecipientEl.textContent = SYNC_VENDOR_NAME;
  managedNotice.hidden = Object.keys(policy).length === 0;
}

// ---------- Render ----------

// Each of these re-renders exactly one list from a fresh settings read,
// rather than the whole page -- used as renderRows' rerenderSelf so
// removing (or adding) one entry doesn't tear down and rebuild every other
// list plus the filter-groups checkboxes too. getEffectiveSettings() (not
// getSettings()) so a managed policy's forced disabledSites/
// customBlockedDomains still shows correctly, matching what the full
// render() below already does.
async function rerenderSiteList(): Promise<void> {
  const settings = await getEffectiveSettings();
  renderDomainList(
    siteList,
    siteEmptyState,
    settings.disabledSites,
    tFallback("commonResume", "Resume"),
    (hostname) => setSiteDisabled(hostname, false).then(() => undefined),
    rerenderSiteList
  );
}

async function rerenderCustomBlockList(): Promise<void> {
  const settings = await getEffectiveSettings();
  renderDomainList(
    customBlockList,
    customBlockEmpty,
    settings.customBlockedDomains,
    tFallback("commonRemove", "Remove"),
    (domain) => sendRemoveCustomDomain("customBlockedDomains", domain),
    rerenderCustomBlockList
  );
}

async function rerenderCustomAllowList(): Promise<void> {
  const settings = await getEffectiveSettings();
  renderDomainList(
    customAllowList,
    customAllowEmpty,
    settings.customAllowedDomains,
    tFallback("commonRemove", "Remove"),
    (domain) => sendRemoveCustomDomain("customAllowedDomains", domain),
    rerenderCustomAllowList
  );
}

async function rerenderHiddenElementList(): Promise<void> {
  const [settings, stats] = await Promise.all([getEffectiveSettings(), getCustomRuleStats()]);
  renderRuleGroup(
    "hide",
    hiddenElementRows,
    hiddenElementEmpty,
    settings.customCosmeticRules,
    stats,
    removeCustomCosmeticRule,
    rerenderHiddenElementList
  );
  grayscaleElementBlock.hidden = Object.keys(settings.customGrayscaleRules).length === 0;
}

async function rerenderGrayscaleElementList(): Promise<void> {
  const [settings, stats] = await Promise.all([getEffectiveSettings(), getCustomRuleStats()]);
  renderRuleGroup(
    "gray",
    grayscaleElementRows,
    grayscaleElementEmpty,
    settings.customGrayscaleRules,
    stats,
    removeGrayscaleRule,
    rerenderGrayscaleElementList
  );
  grayscaleElementBlock.hidden = Object.keys(settings.customGrayscaleRules).length === 0;
}

async function render(): Promise<void> {
  const [settings, policy] = await Promise.all([getEffectiveSettings(), getManagedPolicy()]);

  await renderProtectionTab(settings, policy);
  if (lastUsage) renderWeeklyTrackers(lastUsage);

  renderSyncStatus(settings.syncEnabled, await getSyncStatus());
  renderLiveStatus(await getLiveUpdateStatus(), await getYoutubeQuickFixesStatus());

  renderDomainList(
    siteList,
    siteEmptyState,
    settings.disabledSites,
    tFallback("commonResume", "Resume"),
    (hostname) => setSiteDisabled(hostname, false).then(() => undefined),
    rerenderSiteList
  );

  const filterGroupStatus = await getFilterGroupStatus();
  filterBudgetWarning.hidden = filterGroupStatus === null || filterGroupStatus.ok;
  if (filterGroupStatus?.droppedGroups?.length) {
    const manifest = await loadRulesetManifest();
    const namesByGroup = new Map((manifest ? summarizeFilterLists(manifest) : []).map((l) => [l.group, l.name]));
    const names = filterGroupStatus.droppedGroups.map((group) => namesByGroup.get(group) ?? group).join(", ");
    filterBudgetDetail.hidden = false;
    filterBudgetDetail.textContent = tFallback(
      "optionsFilterBudgetDropped",
      `Turned off for now to stay within your browser's rule limit: ${names}.`,
      [names]
    );
  } else if (filterGroupStatus?.availableStaticRuleCount !== undefined) {
    const availableCount = filterGroupStatus.availableStaticRuleCount;
    filterBudgetDetail.hidden = false;
    filterBudgetDetail.textContent = tFallback(
      "optionsFilterBudgetDetail",
      `Your browser says ${availableCount} rule slots are left for all your extensions combined. Still low after turning off other extensions and reloading Moat? Try turning off a list below, Annoyances or Cookie Notices first.`,
      [String(availableCount)]
    );
  } else {
    filterBudgetDetail.hidden = true;
  }

  const filtersLocked = isLocked("filterGroups", policy);
  filtersLockedBadge.hidden = !filtersLocked;
  for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) button.disabled = filtersLocked;
  await renderFilterLists(settings, new Set(filterGroupStatus?.droppedGroups ?? []));
  for (const input of filterListRows.querySelectorAll("input")) input.disabled = filtersLocked;
  renderLevels(detectPreset(settings), filtersLocked);

  renderDomainList(
    customBlockList,
    customBlockEmpty,
    settings.customBlockedDomains,
    tFallback("commonRemove", "Remove"),
    (domain) => sendRemoveCustomDomain("customBlockedDomains", domain),
    rerenderCustomBlockList
  );
  renderDomainList(
    customAllowList,
    customAllowEmpty,
    settings.customAllowedDomains,
    tFallback("commonRemove", "Remove"),
    (domain) => sendRemoveCustomDomain("customAllowedDomains", domain),
    rerenderCustomAllowList
  );
  const customRuleStats = await getCustomRuleStats();
  renderRuleGroup(
    "hide",
    hiddenElementRows,
    hiddenElementEmpty,
    settings.customCosmeticRules,
    customRuleStats,
    removeCustomCosmeticRule,
    rerenderHiddenElementList
  );
  renderRuleGroup(
    "gray",
    grayscaleElementRows,
    grayscaleElementEmpty,
    settings.customGrayscaleRules,
    customRuleStats,
    removeGrayscaleRule,
    rerenderGrayscaleElementList
  );
  // The "Grayed out" block only appears once someone has actually grayed
  // something out -- most people never will, so it stays out of the way.
  grayscaleElementBlock.hidden = Object.keys(settings.customGrayscaleRules).length === 0;

  await renderBackupTab(settings);
  await renderAboutTab(policy);
}

addButton.addEventListener("click", async () => {
  const hostname = normalizeHostname(addInput.value);
  if (!hostname) return;
  await setSiteDisabled(hostname, true);
  addInput.value = "";
  await rerenderSiteList();
});

addInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addButton.click();
});

// ---------- Backup tab (DR-15) ----------

const exportSettingsButton = document.getElementById("export-settings-button") as HTMLButtonElement;
const importSettingsButton = document.getElementById("import-settings-button") as HTMLButtonElement;
const importSettingsInput = document.getElementById("import-settings-input") as HTMLInputElement;
const importSettingsStatus = document.getElementById("import-settings-status") as HTMLElement;
const importSettingsConfirm = document.getElementById("import-settings-confirm") as HTMLElement;
const importSettingsSummary = document.getElementById("import-settings-summary") as HTMLUListElement;
const importSettingsApplyButton = document.getElementById("import-settings-apply-button") as HTMLButtonElement;
const importSettingsCancelButton = document.getElementById("import-settings-cancel-button") as HTMLButtonElement;
const exportFilenameEl = document.getElementById("export-filename") as HTMLElement;
const backupMetricLastEl = document.getElementById("backup-metric-last") as HTMLElement;
const syncRecipientEl = document.getElementById("sync-recipient") as HTMLElement;

/** Same name the export button itself downloads -- so the hint above it and
 * the file that actually lands in Downloads never say two different things. */
function exportFilename(): string {
  return `moat-settings-${new Date().toISOString().slice(0, 10)}.json`;
}

exportSettingsButton.addEventListener("click", async () => {
  const message: ExportSettingsMessage = { type: "export-settings" };
  const exported = await browser.runtime.sendMessage(message);
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename();
  link.click();
  URL.revokeObjectURL(url);
  await recordBackupTaken();
  await render();
});

importSettingsButton.addEventListener("click", () => importSettingsInput.click());

const syncToggle = document.getElementById("sync-toggle") as HTMLInputElement;
syncToggle.addEventListener("change", async () => {
  await setSettings({ syncEnabled: syncToggle.checked });
});

async function renderBackupTab(settings: Settings): Promise<void> {
  exportFilenameEl.textContent = exportFilename();
  syncToggle.checked = settings.syncEnabled;
  syncRecipientEl.textContent = SYNC_VENDOR_NAME;

  const lastBackupAt = await getLastBackupAt();
  if (lastBackupAt === null) {
    backupMetricLastEl.textContent = tFallback("commonNever", "Never");
    backupMetricLastEl.classList.add("caution");
  } else {
    backupMetricLastEl.textContent = new Date(lastBackupAt).toLocaleDateString();
    backupMetricLastEl.classList.remove("caution");
  }

}

// ---------- Trackers tab ----------

const trackerRows = document.getElementById("tracker-rows") as HTMLElement;
const trackersSubhead = document.getElementById("trackers-subhead") as HTMLElement;
const trackersEmpty = document.getElementById("trackers-empty") as HTMLElement;
const trackersUnsupported = document.getElementById("trackers-unsupported") as HTMLElement;
const trackersRefresh = document.getElementById("trackers-refresh") as HTMLAnchorElement;

/** The weekly aggregate (fed by usageStats.ts, real local history) sits
 * above the existing live per-tab breakdown below -- unrelated data
 * sources, both real, shown together. */
function renderWeeklyTrackers(usage: UsageSummaryResponse): void {
  const companies = usage.companiesThisWeek.length.toLocaleString();
  const attempts = usage.companiesThisWeek.reduce((sum, company) => sum + company.count, 0).toLocaleString();
  document.getElementById("weekly-tracker-summary")!.textContent = tFallback(
    "advTrackersSummary",
    `${companies} companies · ${attempts} attempts blocked this week`,
    [companies, attempts]
  );

  const container = document.getElementById("weekly-tracker-rows") as HTMLElement;
  const top = usage.companiesThisWeek.slice(0, 20);
  const maxCount = Math.max(...top.map((company) => company.count), 1);
  container.replaceChildren(
    ...top.map((company) => {
      const row = document.createElement("div");
      row.className = "weekly-tracker-row";

      const nameCell = document.createElement("div");
      nameCell.className = "wt-name-cell";
      const name = document.createElement("div");
      name.className = "wt-name";
      name.textContent = company.company;
      const reach = document.createElement("div");
      reach.className = "wt-reach";
      reach.textContent = tFallback("optionsCompanyReach", `${company.hostnameCount} sites`, String(company.hostnameCount));
      nameCell.append(name, reach);

      // Fill is relative to the top company's own count, not a total -- a
      // share-of-100% chart would imply a completeness this data doesn't
      // have (only a fraction of trackers carry a known company mapping).
      const track = document.createElement("div");
      track.className = "wt-bar-track";
      const fill = document.createElement("div");
      fill.className = "wt-bar-fill";
      fill.style.width = `${Math.max((company.count / maxCount) * 100, 4)}%`;
      track.append(fill);

      const count = document.createElement("div");
      count.className = "wt-count";
      count.textContent = company.count.toLocaleString();

      row.append(nameCell, track, count);
      return row;
    })
  );
}

// company name -> { description, url }, fetched once on first view. Lazy on
// purpose: it's ~450KB of text nobody needs unless they open this tab.
let companyInfoCache: Record<string, CompanyInfo> | null = null;

async function loadCompanyInfo(): Promise<Record<string, CompanyInfo>> {
  if (companyInfoCache) return companyInfoCache;
  try {
    const url = browser.runtime.getURL("rules/company-info.json");
    companyInfoCache = (await (await fetch(url)).json()) as Record<string, CompanyInfo>;
  } catch {
    companyInfoCache = {};
  }
  return companyInfoCache;
}

async function renderTrackers(): Promise<void> {
  const message: GetCompanyBreakdownMessage = { type: "get-company-breakdown" };
  const [status, info] = await Promise.all([
    browser.runtime.sendMessage(message) as Promise<CompanyBreakdownResponse>,
    loadCompanyInfo(),
  ]);

  trackersUnsupported.hidden = status.supported;
  if (status.hostname) {
    trackersSubhead.hidden = false;
    trackersSubhead.textContent = tFallback(
      "optionsTrackersSeenOn",
      `Companies blocked on ${status.hostname}.`,
      [status.hostname]
    );
  } else {
    trackersSubhead.hidden = true;
  }

  const rows = joinCompanyBreakdown(status.companyBreakdown, info);
  trackersEmpty.hidden = rows.length > 0;
  trackerRows.replaceChildren(
    ...rows.map((row) => {
      const wrap = document.createElement("div");
      wrap.className = "tracker-row";

      const head = document.createElement("div");
      head.className = "tr-head";
      const name = document.createElement(row.url ? "a" : "span");
      name.className = "tr-name";
      name.textContent = row.company;
      if (row.url && name instanceof HTMLAnchorElement) {
        name.href = row.url;
        name.target = "_blank";
        name.rel = "noopener";
      }
      const count = document.createElement("span");
      count.className = "tr-count";
      count.textContent = tFallback("optionsTrackersCount", `${row.count} blocked`, String(row.count));
      head.append(name, count);
      wrap.append(head);

      if (row.description) {
        const desc = document.createElement("p");
        desc.className = "tr-desc";
        desc.textContent = row.description;
        wrap.append(desc);
      }
      return wrap;
    })
  );
}

trackersRefresh.addEventListener("click", (event) => {
  event.preventDefault();
  void renderTrackers();
});

// Holds the parsed, already-validated payload between "file chosen" and
// "Apply this import" clicked -- nothing is sent to the background, and
// nothing is applied, until the user explicitly confirms the summary below.
// Previously this ran the actual import the instant a file was chosen,
// directly contradicting the row's own copy ("You'll see what changes
// before it applies").
let pendingImportPayload: unknown = null;

function resetImportConfirm(): void {
  pendingImportPayload = null;
  importSettingsConfirm.hidden = true;
  importSettingsSummary.replaceChildren();
}

function addImportSummaryItem(key: string, fallback: string): void {
  const item = document.createElement("li");
  item.textContent = tFallback(key, fallback);
  importSettingsSummary.append(item);
}

importSettingsInput.addEventListener("change", async () => {
  const file = importSettingsInput.files?.[0];
  if (!file) return;
  importSettingsStatus.hidden = true;
  resetImportConfirm();
  try {
    const payload = JSON.parse(await file.text());
    // Client-side validation only, against the CURRENT settings this page
    // already has in memory -- purely to build the preview. The background
    // handler re-validates this same payload independently before ever
    // applying it (defense in depth, same posture as every other untrusted-
    // import boundary in this codebase), so a stale/tampered pendingImportPayload
    // by the time Apply is clicked still can't bypass real validation.
    const patch = validateImportedSettings(payload);
    if (!patch) {
      importSettingsStatus.hidden = false;
      importSettingsStatus.textContent = tFallback("optionsImportedInvalid", "That file doesn't look like a valid Moat settings export.");
      return;
    }

    const current = lastSettings ?? (await getEffectiveSettings());
    const summary = summarizeSettingsImport(current, patch);
    if (summary.isNoOp) {
      addImportSummaryItem("optionsImportNoChanges", "This file matches your current settings. Nothing would change.");
    } else {
      if (summary.protectionSettingsChanged > 0) addImportSummaryItem("optionsImportChangeProtections", "Protection settings");
      if (summary.customRulesChanged) addImportSummaryItem("optionsImportChangeRules", "Custom rules");
      if (summary.siteExceptionsChanged) addImportSummaryItem("optionsImportChangeExceptions", "Site exceptions");
      if (summary.filterListChoicesChanged) addImportSummaryItem("optionsImportChangeFilterLists", "Filter list choices");
      if (summary.syncSettingChanged) addImportSummaryItem("optionsImportChangeSync", "Sync setting");
    }
    pendingImportPayload = payload;
    importSettingsConfirm.hidden = false;
  } catch {
    importSettingsStatus.hidden = false;
    importSettingsStatus.textContent = tFallback("optionsImportReadError", "Couldn't read that file.");
  } finally {
    importSettingsInput.value = "";
  }
});

importSettingsApplyButton.addEventListener("click", async () => {
  if (pendingImportPayload === null) return;
  const message: ImportSettingsMessage = { type: "import-settings", payload: pendingImportPayload };
  const result = (await browser.runtime.sendMessage(message)) as ImportSettingsResponse;
  resetImportConfirm();
  importSettingsStatus.hidden = false;
  importSettingsStatus.textContent = result.ok
    ? tFallback("optionsImportedSuccess", "Settings imported.")
    : tFallback("optionsImportedInvalid", "That file doesn't look like a valid Moat settings export.");
  if (result.ok) await render();
});

importSettingsCancelButton.addEventListener("click", () => {
  resetImportConfirm();
});

// ---------- Welcome panel (first run only) ----------

const shellEl = document.getElementById("shell") as HTMLElement;
const welcomePanel = document.getElementById("welcome-panel") as HTMLElement;

void shouldShowWelcome().then((show) => {
  if (!show) return;
  shellEl.hidden = true;
  welcomePanel.hidden = false;
});

document.getElementById("welcome-continue")!.addEventListener("click", async () => {
  await dismissWelcome();
  welcomePanel.hidden = true;
  shellEl.hidden = false;
});

// render() runs unconditionally, whether or not the welcome panel is
// currently showing over #shell -- cheap, and it means Settings is already
// populated the instant "Continue" is clicked instead of needing its own
// loading state.
void render();

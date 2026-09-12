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
import { customRuleStatKey, isStale } from "../shared/customRuleStats";
import type {
  AddCustomDomainMessage,
  CheckForLiveUpdatesMessage,
  CompanyBreakdownResponse,
  CustomDomainListField,
  CustomRuleStat,
  ExportSettingsMessage,
  FilterListMatchesResponse,
  GetCompanyBreakdownMessage,
  GetFilterListMatchesMessage,
  ImportSettingsMessage,
  ImportSettingsResponse,
  RemoveCosmeticRuleMessage,
  RemoveCustomDomainMessage,
  RemoveGrayscaleRuleMessage,
  Settings,
  SetSettingsPatchMessage,
  StartElementPickerMessage,
  StartElementPickerResponse,
  ToggleSiteMessage,
  UsageSignal,
  UsageSummaryResponse,
} from "../types";
import { joinCompanyBreakdown, type CompanyInfo } from "./trackerView";
import { applyStaticI18n, getMessageOrFallback } from "../shared/i18n";

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
async function sendAddCustomDomain(field: CustomDomainListField, hostname: string): Promise<void> {
  const message: AddCustomDomainMessage = { type: "add-custom-domain", field, hostname };
  await browser.runtime.sendMessage(message);
}

async function sendRemoveCustomDomain(field: CustomDomainListField, hostname: string): Promise<void> {
  const message: RemoveCustomDomainMessage = { type: "remove-custom-domain", field, hostname };
  await browser.runtime.sendMessage(message);
}

function tFallback(key: string, fallback: string, substitutions?: string | string[]): string {
  return getMessageOrFallback((k, s) => browser.i18n.getMessage(k, s), key, fallback, substitutions);
}

applyStaticI18n(document, (key, subs) => browser.i18n.getMessage(key, subs));

// ---------- Tabs ----------

const tabButtons = document.querySelectorAll<HTMLButtonElement>(".rail-item");
const tabPanels = document.querySelectorAll<HTMLElement>("[data-tab-panel]");
const contentColumn = document.getElementById("content-column") as HTMLElement;
const drawer = document.getElementById("drawer") as HTMLElement;

function closeDrawer(): void {
  openDrawerId = null;
  drawer.hidden = true;
}

function selectTab(name: string): void {
  for (const button of tabButtons) button.setAttribute("aria-selected", String(button.dataset.tab === name));
  for (const panel of tabPanels) panel.hidden = panel.dataset.tabPanel !== name;
  // Only the Protection tab's content reserves the drawer's 330px gutter --
  // see options.html's .has-drawer comment. Leaving it on for every tab
  // would waste a third of the page width on tabs that never open a drawer.
  contentColumn.classList.toggle("has-drawer", name === "protection");
  if (name !== "protection") closeDrawer();
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const name = button.dataset.tab!;
    selectTab(name);
    if (name === "trackers") void renderTrackers();
  });
}

// ---------- Protection tab ----------

type ProtectionGroup = "privacy" | "annoyances" | "safety";

/** Which usage-summary field an "on" row's evidence line reads. "week" is
 * the default (a distinct-hostname count over the trailing 7 days); the
 * grayscale ad-dimmer only ever runs on YouTube, so a hostname count would
 * always read "1 site" -- it reads a daily event count instead. */
type EvidenceUnit = "week" | "today";

interface ProtectionDef {
  id: string;
  settingKey: keyof Settings;
  group: ProtectionGroup;
  titleKey: readonly [string, string];
  descKey: readonly [string, string];
  cautionKey?: readonly [string, string];
  signal?: UsageSignal;
  metricLabelKey?: readonly [string, string];
  evidenceUnit?: EvidenceUnit;
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
    titleKey: ["optionsCookiesToggleLabel", "Block third-party cookies"],
    descKey: ["optionsCookiesToggleHint", "Stops sites from tracking you as you move from one to the next."],
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
    titleKey: ["optionsFingerprintToggleLabel", "Block browser fingerprinting"],
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

const GROUP_ORDER: ProtectionGroup[] = ["privacy", "annoyances", "safety"];
const GROUP_LABELS: Record<ProtectionGroup, readonly [string, string]> = {
  privacy: ["optionsPrivacyCategory", "Privacy"],
  annoyances: ["optionsAnnoyancesCategory", "Annoyances"],
  safety: ["optionsSafetyCategory", "Safety"],
};

// permission-guard is one merged row (three chips) sitting in the "safety"
// group alongside the plain PROTECTIONS entries above, but its shape is
// different enough (three independent booleans, no single switch, no
// drawer) that it isn't modeled as a ProtectionDef at all -- see
// buildPermissionGuardRow.
function isAnyPermissionGuardOn(settings: Settings): boolean {
  return settings.permissionGuardCamera || settings.permissionGuardMicrophone || settings.permissionGuardLocation;
}

const TOTAL_PROTECTIONS = PROTECTIONS.length + 1; // +1 for the merged permission-guard row

const masterToggle = document.getElementById("master-toggle") as HTMLInputElement;
const protectionLockedBadge = document.getElementById("protection-locked-badge") as HTMLElement;
const railDotProtection = document.getElementById("rail-dot-protection") as HTMLElement;
const railCountFilters = document.getElementById("rail-count-filters") as HTMLElement;
const railCountCustom = document.getElementById("rail-count-custom") as HTMLElement;
const railCountTrackers = document.getElementById("rail-count-trackers") as HTMLElement;
const protectionGroupsEl = document.getElementById("protection-groups") as HTMLElement;

const drawerTitleEl = document.getElementById("drawer-title") as HTMLElement;
const drawerStateEl = document.getElementById("drawer-state") as HTMLElement;
const drawerToggleEl = document.getElementById("drawer-toggle") as HTMLInputElement;
const drawerMetricWrapEl = document.getElementById("drawer-metric") as HTMLElement;
const drawerMetricValueEl = document.getElementById("drawer-metric-value") as HTMLElement;
const drawerMetricLabelEl = document.getElementById("drawer-metric-label") as HTMLElement;
const drawerBarsWrapEl = document.getElementById("drawer-bars-wrap") as HTMLElement;
const drawerBarsEl = document.getElementById("drawer-bars") as HTMLElement;
const drawerDescEl = document.getElementById("drawer-desc") as HTMLElement;
const drawerCautionEl = document.getElementById("drawer-caution") as HTMLElement;
const drawerCautionTextEl = document.getElementById("drawer-caution-text") as HTMLElement;

const cnameUnsupportedHint = tFallback("optionsCnameUnsupportedHint", "Not available in this browser.");
const cnameChromeDohHint = tFallback(
  "optionsCnameChromeDohHint",
  "On Chrome, this checks disguised trackers using Cloudflare's public lookup service, and may miss the very first one it finds -- it catches every one after that. Firefox does this itself, more privately, and catches every one from the start."
);

const liveStatus = document.getElementById("live-status") as HTMLElement | null;
const siteList = document.getElementById("site-list") as HTMLUListElement;
const siteEmptyState = document.getElementById("site-empty-state") as HTMLElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const addButton = document.getElementById("add-button") as HTMLButtonElement;

// Set once by the top-level render() below and read by drawer open/refresh
// so re-opening or re-populating an already-open drawer doesn't need its
// own separate fetch of settings/usage data.
let lastSettings: Settings | null = null;
let lastUsage: UsageSummaryResponse | null = null;
let openDrawerId: string | null = null;

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
    `Couldn't sync your settings (${when}) -- you may have too many custom rules or sites for your ` +
      `browser's sync storage. They're still saved on this device.`,
    [when]
  );
}

function normalizeHostname(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
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

// ---------- Metric row + sparkline ----------

function renderSparkline(values: number[], elementId = "metric-sparkline"): void {
  const svg = document.getElementById(elementId) as unknown as SVGSVGElement;
  const width = 132;
  const height = 40;
  const pad = 3;
  const max = Math.max(...values, 1);
  const points = values.map((value, i) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(values.length - 1, 1);
    const y = height - pad - (value / max) * (height - pad * 2);
    return [x, y] as const;
  });

  const ns = "http://www.w3.org/2000/svg";
  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));

  const last = points[points.length - 1];
  const children: SVGElement[] = [polyline];
  if (last) {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", last[0].toFixed(1));
    circle.setAttribute("cy", last[1].toFixed(1));
    circle.setAttribute("r", "3");
    children.push(circle);
  }
  svg.replaceChildren(...children);
}

function renderMetricRow(usage: UsageSummaryResponse): void {
  document.getElementById("metric-blocked-today")!.textContent = usage.today.total.toLocaleString();

  const deltaEl = document.getElementById("metric-blocked-delta") as HTMLElement;
  const deltaValueEl = document.getElementById("metric-blocked-delta-value") as HTMLElement;
  const baselineEl = document.getElementById("metric-blocked-baseline") as HTMLElement;
  const baseline = tFallback("optionsBlockedTodayBaseline", "blocked today");

  if (usage.lastWeekSameWeekday) {
    const lastWeekTotal = usage.lastWeekSameWeekday.total;
    baselineEl.textContent =
      baseline +
      tFallback(
        "optionsBlockedTodayComparison",
        ` · vs ${lastWeekTotal.toLocaleString()} same day last week`,
        String(lastWeekTotal)
      );
    if (lastWeekTotal > 0 && usage.today.total !== lastWeekTotal) {
      const pct = Math.round(((usage.today.total - lastWeekTotal) / lastWeekTotal) * 100);
      deltaEl.hidden = false;
      deltaValueEl.textContent = `${pct > 0 ? "+" : ""}${pct}%`;
    } else {
      deltaEl.hidden = true;
    }
  } else {
    baselineEl.textContent = baseline;
    deltaEl.hidden = true;
  }

  renderSparkline(usage.sparkline);

  document.getElementById("metric-sites-today")!.textContent = usage.today.hostnameCount.toLocaleString();

  const onCount =
    PROTECTIONS.filter((def) => Boolean(lastSettings?.[def.settingKey])).length +
    (lastSettings && isAnyPermissionGuardOn(lastSettings) ? 1 : 0);
  const protectionsOnEl = document.getElementById("metric-protections-on") as HTMLElement;
  const suffix = document.createElement("span");
  suffix.className = "of-muted";
  suffix.textContent = `/${TOTAL_PROTECTIONS}`;
  protectionsOnEl.replaceChildren(String(onCount), suffix);
}

// ---------- Protection rows + drawer ----------

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
  const row = document.createElement("div");
  row.className = openDrawerId === def.id ? "protection-row selected" : "protection-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-expanded", String(openDrawerId === def.id));

  const body = document.createElement("div");
  body.className = "row-body";
  const title = document.createElement("span");
  title.className = checked ? "row-title" : "row-title off";
  title.id = `protection-${def.id}-label`;
  title.textContent = tFallback(...def.titleKey);
  body.append(title);

  if (checked) {
    const evidence = evidenceTextFor(def, usage);
    if (evidence) {
      const evidenceEl = document.createElement("span");
      evidenceEl.className = "row-evidence";
      evidenceEl.textContent = evidence;
      body.append(evidenceEl);
    }
  }

  const toggle = buildSwitch(checked, title.id, (next) => {
    void setSettings({ [def.settingKey]: next } as Partial<Settings>).then(() => render());
  });

  row.append(body, toggle);
  row.addEventListener("click", () => toggleDrawer(def.id));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      toggleDrawer(def.id);
    }
  });

  return row;
}

function buildFingerprintRotateRow(settings: Settings): HTMLElement {
  const row = document.createElement("div");
  row.className = "protection-subrow";
  const title = document.createElement("span");
  title.className = "row-title";
  title.id = "fingerprint-rotate-toggle-label";
  title.textContent = tFallback(
    "optionsFingerprintRotateToggleLabel",
    "Use a new disguise each time you restart"
  );
  const toggle = buildSwitch(settings.fingerprintRotatePerSession, title.id, (next) => {
    void setSettings({ fingerprintRotatePerSession: next }).then(() => render());
  });
  row.append(title, toggle);
  return row;
}

function buildPermissionGuardRow(settings: Settings): HTMLElement {
  const row = document.createElement("div");
  row.className = "protection-row";

  const body = document.createElement("div");
  body.className = "row-body";
  const title = document.createElement("span");
  title.className = isAnyPermissionGuardOn(settings) ? "row-title" : "row-title off";
  title.textContent = tFallback("optionsPermissionGuardMergedLabel", "Block ambush permission prompts");
  body.append(title);

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
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      void setSettings({ [kind.key]: !on } as Partial<Settings>).then(() => render());
    });
    chips.append(chip);
  }
  body.append(chips);
  row.append(body);
  return row;
}

function renderBars(values: number[]): HTMLElement[] {
  const max = Math.max(...values, 1);
  return values.map((value, i) => {
    const bar = document.createElement("div");
    bar.className = i >= values.length - 2 ? "bar recent" : "bar";
    bar.style.height = `${Math.max((value / max) * 100, value > 0 ? 8 : 0)}%`;
    return bar;
  });
}

function populateDrawer(id: string): void {
  const def = PROTECTIONS.find((p) => p.id === id);
  if (!def || !lastSettings) return;
  const settings = lastSettings;
  const usage = lastUsage;
  const checked = Boolean(settings[def.settingKey]);

  drawerTitleEl.textContent = tFallback(...def.titleKey);
  let state = checked ? tFallback("optionsDrawerStateOn", "On") : tFallback("optionsDrawerStateOff", "Off");
  if (def.id === "fingerprint" && checked && settings.fingerprintRotatePerSession) {
    state += ` · ${tFallback("optionsDrawerStateAdvanced", "advanced")}`;
  }
  drawerStateEl.textContent = state;
  drawerToggleEl.checked = checked;
  drawerToggleEl.onchange = () => {
    void setSettings({ [def.settingKey]: drawerToggleEl.checked } as Partial<Settings>).then(() => render());
  };

  const signalSummary = def.signal && usage ? usage.bySignal[def.signal] : undefined;
  if (def.signal && signalSummary) {
    const value =
      def.evidenceUnit === "today"
        ? def.id === "grayscale"
          ? signalSummary.todayCount
          : signalSummary.todayHostnameCount
        : signalSummary.weekHostnameCount;
    drawerMetricWrapEl.hidden = false;
    drawerMetricValueEl.textContent = value.toLocaleString();
    drawerMetricLabelEl.textContent = def.metricLabelKey ? tFallback(...def.metricLabelKey) : "";
    drawerBarsWrapEl.hidden = false;
    drawerBarsEl.replaceChildren(...renderBars(signalSummary.sevenDayBars));
  } else {
    drawerMetricWrapEl.hidden = true;
    drawerBarsWrapEl.hidden = true;
  }

  drawerDescEl.replaceChildren(tFallback(...def.descKey));
  if (def.id === "cname") {
    const firefoxSupported = isCnameUncloakFirefoxSupported();
    const chromeSupported = isCnameUncloakChromeSupported();
    if (!firefoxSupported && !chromeSupported) {
      drawerDescEl.append(document.createElement("br"), document.createElement("br"), cnameUnsupportedHint);
    } else if (chromeSupported) {
      drawerDescEl.append(document.createElement("br"), document.createElement("br"), cnameChromeDohHint);
    }
  }

  if (def.cautionKey) {
    drawerCautionEl.hidden = false;
    drawerCautionTextEl.textContent = tFallback(...def.cautionKey);
  } else {
    drawerCautionEl.hidden = true;
  }
}

function toggleDrawer(id: string): void {
  if (openDrawerId === id) {
    closeDrawer();
  } else {
    openDrawerId = id;
    drawer.hidden = false;
    populateDrawer(id);
  }
  if (lastSettings && lastUsage) renderProtectionGroups(lastSettings, lastUsage);
}

document.addEventListener("click", (event) => {
  if (!openDrawerId || drawer.hidden) return;
  const target = event.target as HTMLElement;
  if (drawer.contains(target) || target.closest(".protection-row")) return;
  closeDrawer();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openDrawerId) closeDrawer();
});

function renderProtectionGroups(settings: Settings, usage: UsageSummaryResponse): void {
  const groups = GROUP_ORDER.map((group) => {
    const defs = PROTECTIONS.filter((def) => def.group === group);
    const extra = group === "safety" ? 1 : 0; // the merged permission-guard row
    const onCount =
      defs.filter((def) => Boolean(settings[def.settingKey])).length +
      (group === "safety" && isAnyPermissionGuardOn(settings) ? 1 : 0);
    const total = defs.length + extra;

    const heading = document.createElement("div");
    heading.className = "group-heading";
    const label = document.createElement("span");
    label.textContent = tFallback(...GROUP_LABELS[group]);
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = tFallback("optionsGroupOnCount", `${onCount} of ${total} on`, [String(onCount), String(total)]);
    heading.append(label, count);

    const rowGroup = document.createElement("div");
    rowGroup.className = "row-group";
    for (const def of defs) {
      rowGroup.append(buildProtectionRow(def, settings, usage));
      if (def.id === "fingerprint" && settings.fingerprintResistance) {
        rowGroup.append(buildFingerprintRotateRow(settings));
      }
    }
    if (group === "safety") rowGroup.append(buildPermissionGuardRow(settings));

    return [heading, rowGroup];
  });

  protectionGroupsEl.replaceChildren(...groups.flat());
}

async function renderProtectionTab(settings: Settings, policy: Awaited<ReturnType<typeof getManagedPolicy>>): Promise<void> {
  const protectionLocked = isLocked("protection", policy);
  masterToggle.checked = settings.enabled;
  masterToggle.disabled = protectionLocked;
  protectionLockedBadge.hidden = !protectionLocked;
  railDotProtection.hidden = !settings.enabled;

  const usage = await getUsageSummary();
  lastSettings = settings;
  lastUsage = usage;

  renderMetricRow(usage);
  renderProtectionGroups(settings, usage);
  if (openDrawerId) populateDrawer(openDrawerId);

  railCountTrackers.textContent = String(usage.companiesThisWeek.length);
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
      `Last attempt failed (${when}) -- still using the built-in list until the next try.`,
      [when]
    );
    return;
  }
  let text = tFallback("optionsLiveStatusOk", `Last updated ${when} — ${status.domainCount} domains.`, [
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
  strict: { key: "presetHintStrict", fallback: "Every list, plus the privacy toggles above." },
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

async function countEnabledFilterLists(settings: Settings): Promise<number> {
  const manifest = await loadRulesetManifest();
  if (!manifest) return 0;
  const lists = summarizeFilterLists(manifest);
  const state = effectiveFilterGroupState(
    settings.enabled,
    settings.filterGroups,
    lists.map((list) => list.group)
  );
  return Object.values(state).filter(Boolean).length;
}

/** Real, not a fabricated span -- "1h"/"45m"/"3d" since the live-update
 * channel's own last-recorded check, same rounding idiom as logger.ts's
 * formatSince for the rule-match log. */
function formatSinceShort(when: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - when) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

async function renderFilterListsMetricRow(
  settings: Settings,
  lists: ReturnType<typeof summarizeFilterLists>,
  liveStatus: Awaited<ReturnType<typeof getLiveUpdateStatus>>
): Promise<void> {
  const state = effectiveFilterGroupState(
    settings.enabled,
    settings.filterGroups,
    lists.map((list) => list.group)
  );
  const activeRuleCount = lists.filter((list) => state[list.group]).reduce((sum, list) => sum + list.ruleCount, 0);

  document.getElementById("filters-metric-active")!.textContent = activeRuleCount.toLocaleString();
  document.getElementById("filters-metric-baseline")!.textContent = tFallback(
    "optionsRulesActiveBaseline",
    `rules active · Chrome's cap is ${CHROME_GLOBAL_STATIC_RULE_LIMIT.toLocaleString()}`,
    CHROME_GLOBAL_STATIC_RULE_LIMIT.toLocaleString()
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

  document.getElementById("filters-metric-live")!.textContent = (liveStatus?.domainCount ?? 0).toLocaleString();
  document.getElementById("filters-metric-since-check")!.textContent = liveStatus
    ? formatSinceShort(liveStatus.timestamp)
    : "—";
}

/** Updated synchronously (before any await) on every checkbox change below,
 * so two filter-list toggles fired in quick succession each merge onto the
 * other's already-applied change instead of racing two independent
 * getSettings() reads and clobbering one write with the other. */
let currentFilterGroups: Settings["filterGroups"] | null = null;

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

  await renderFilterListsMetricRow(settings, lists, await getLiveUpdateStatus());

  const matchesMessage: GetFilterListMatchesMessage = { type: "get-filter-list-matches" };
  const matches = (await browser.runtime.sendMessage(matchesMessage)) as FilterListMatchesResponse;

  filterListRows.replaceChildren();
  for (const list of lists.sort((a, b) => b.ruleCount - a.ruleCount)) {
    const row = document.createElement("div");
    row.className = "protection-row";

    const body = document.createElement("div");
    body.className = "row-body";
    const name = document.createElement("span");
    name.className = "row-title";
    name.id = `filter-list-${list.group}-label`;
    name.textContent = list.name;
    body.append(name);

    const matchCount = matches.matchesByGroup[list.group] ?? 0;
    const countText = tFallback("optionsRuleCount", `${list.ruleCount.toLocaleString()} rules`, list.ruleCount.toLocaleString());
    const matchedSuffix =
      matchCount > 0 ? tFallback("optionsFilterMatchedOnPage", ` · matched ${matchCount} times on this page`, String(matchCount)) : "";
    const evidence = document.createElement("span");
    evidence.className = "row-evidence";
    evidence.textContent = countText + matchedSuffix;
    body.append(evidence);

    // The toggle below reflects what the user *asked for* (settings.filterGroups), which isn't
    // necessarily what's actually enabled in Chrome right now -- a toggle showing "on" while the
    // browser's shared rule budget silently kept it off would be actively misleading, so this
    // list's own row gets a visible badge instead of just relying on the summary text above the
    // list (see applyFilterGroupState's drop-priority retry in background/filterGroups.ts).
    if (droppedGroups.has(list.group)) {
      const badge = document.createElement("span");
      badge.className = "locked-badge budget-badge";
      badge.textContent = tFallback("optionsFilterBudgetDroppedBadge", "Not active (browser limit reached)");
      body.append(badge);
    }

    const toggle = buildSwitch(settings.filterGroups[list.group] ?? true, name.id, (checked) => {
      const updated = { ...(currentFilterGroups ?? settings.filterGroups), [list.group]: checked };
      currentFilterGroups = updated;
      void setSettings({ filterGroups: updated }).then(() => render());
    });

    row.append(body, toggle);
    filterListRows.append(row);
  }
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

const customAllowList = document.getElementById("custom-allow-list") as HTMLUListElement;
const customAllowEmpty = document.getElementById("custom-allow-empty") as HTMLElement;
const customAllowInput = document.getElementById("custom-allow-input") as HTMLInputElement;
const customAllowAdd = document.getElementById("custom-allow-add") as HTMLButtonElement;

async function addCustomDomain(field: CustomDomainListField, input: HTMLInputElement): Promise<void> {
  const hostname = normalizeHostname(input.value);
  if (!hostname) return;
  await sendAddCustomDomain(field, hostname);
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
        tFallback("optionsRuleStaleMeta", "Hasn't matched in 30 days — the site probably changed")
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

function countCustomRules(settings: Settings): number {
  const hide = Object.values(settings.customCosmeticRules).reduce((sum, selectors) => sum + selectors.length, 0);
  const gray = Object.values(settings.customGrayscaleRules).reduce((sum, selectors) => sum + selectors.length, 0);
  return hide + gray;
}

async function renderCustomRulesMetricRow(settings: Settings): Promise<void> {
  const stats = await getCustomRuleStats();
  const hideEntries = Object.entries(settings.customCosmeticRules).flatMap(([hostname, selectors]) =>
    selectors.map((selector) => ({ kind: "hide" as const, hostname, selector }))
  );
  const grayEntries = Object.entries(settings.customGrayscaleRules).flatMap(([hostname, selectors]) =>
    selectors.map((selector) => ({ kind: "gray" as const, hostname, selector }))
  );
  const all = [...hideEntries, ...grayEntries];
  const now = Date.now();

  let staleCount = 0;
  let totalHits = 0;
  for (const entry of all) {
    const stat = stats[customRuleStatKey(entry.kind, entry.hostname, entry.selector)];
    if (!stat) continue;
    totalHits += stat.hitCount;
    if (isStale(stat, now)) staleCount += 1;
  }

  const siteCount = new Set(all.map((entry) => entry.hostname)).size;
  document.getElementById("custom-metric-count")!.textContent = String(all.length);
  document.getElementById("custom-metric-baseline")!.textContent =
    tFallback("optionsCustomRulesBaseline", `${all.length} rules, across ${siteCount} sites`, [
      String(all.length),
      String(siteCount),
    ]) +
    " · " +
    tFallback("optionsHiddenTimesBaseline", `Hidden ${totalHits} times so far`, String(totalHits));
  document.getElementById("custom-metric-matching")!.textContent = String(all.length - staleCount);
  document.getElementById("custom-metric-stale")!.textContent = String(staleCount);
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

// ---------- About tab ----------

const versionText = document.getElementById("version-text") as HTMLElement;
const managedNotice = document.getElementById("managed-notice") as HTMLElement;

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
  await renderCustomRulesMetricRow(settings);
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
  await renderCustomRulesMetricRow(settings);
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
      `Your browser says ${availableCount} rule slots are left for all your extensions combined. Still low after turning off other extensions and reloading Moat? Turn off a list below -- Annoyances or Cookie Notices first.`,
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
  railCountFilters.textContent = String(await countEnabledFilterLists(settings));

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
  await renderCustomRulesMetricRow(settings);
  railCountCustom.textContent = String(countCustomRules(settings));

  const version = browser.runtime.getManifest().version;
  versionText.textContent = tFallback("optionsVersionPrefix", `v${version}`, version);
  managedNotice.hidden = Object.keys(policy).length === 0;
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

// ---------- Backup & restore ----------

const exportSettingsButton = document.getElementById("export-settings-button") as HTMLButtonElement;
const importSettingsButton = document.getElementById("import-settings-button") as HTMLButtonElement;
const importSettingsInput = document.getElementById("import-settings-input") as HTMLInputElement;
const importSettingsStatus = document.getElementById("import-settings-status") as HTMLElement;

exportSettingsButton.addEventListener("click", async () => {
  const message: ExportSettingsMessage = { type: "export-settings" };
  const exported = await browser.runtime.sendMessage(message);
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `moat-settings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

importSettingsButton.addEventListener("click", () => importSettingsInput.click());

const syncToggle = document.getElementById("sync-toggle") as HTMLInputElement;
syncToggle.addEventListener("change", async () => {
  await setSettings({ syncEnabled: syncToggle.checked });
});

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
  document.getElementById("weekly-metric-companies")!.textContent = usage.companiesThisWeek.length.toLocaleString();
  renderSparkline(usage.companiesTrend, "weekly-sparkline");

  const totalAttempts = usage.companiesThisWeek.reduce((sum, company) => sum + company.count, 0);
  document.getElementById("weekly-metric-attempts")!.textContent = totalAttempts.toLocaleString();
  // "got through" stays a hardcoded 0 in the markup -- Moat has no signal
  // for a tracker that got through undetected (there would be nothing to
  // count), so showing anything else here would be a fabricated number.

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

importSettingsInput.addEventListener("change", async () => {
  const file = importSettingsInput.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const message: ImportSettingsMessage = { type: "import-settings", payload };
    const result = (await browser.runtime.sendMessage(message)) as ImportSettingsResponse;
    importSettingsStatus.hidden = false;
    importSettingsStatus.textContent = result.ok
      ? tFallback("optionsImportedSuccess", "Settings imported.")
      : tFallback("optionsImportedInvalid", "That file doesn't look like a valid Moat settings export.");
    if (result.ok) await render();
  } catch {
    importSettingsStatus.hidden = false;
    importSettingsStatus.textContent = tFallback("optionsImportReadError", "Couldn't read that file.");
  } finally {
    importSettingsInput.value = "";
  }
});

void render();

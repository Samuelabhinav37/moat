import browser from "webextension-polyfill";
import { getEffectiveSettings, getSyncStatus } from "../background/settings";
import { getManagedPolicy, isLocked } from "../background/managedPolicy";
import { getLiveUpdateStatus, getYoutubeQuickFixesStatus } from "../background/liveUpdates";
import { getFilterGroupStatus } from "../background/filterGroups";
import { effectiveFilterGroupState } from "../background/filterGroupState";
import { isSupported as isCnameUncloakFirefoxSupported } from "../background/cnameUncloak";
import { isSupported as isCnameUncloakChromeSupported } from "../background/cnameUncloakChrome";
import { detectPreset, presetDifference, presetPatch, type PresetName } from "../shared/filterPresets";
import { summarizeFilterLists, type RulesetManifestEntry } from "../shared/rulesetManifest";
import { getUsageSummary } from "../background/usageStats";
import { applyLongList, type LongListLabels } from "./longList";
import { applyBulkSelect, type BulkLabels } from "./bulkSelect";
import { buildSiteIcon, faviconUrl } from "./siteIcon";
import { initDashboard, pageFromHash } from "./dashboard";
import { buildExplainer, helpSceneFor, initExplainerPanel } from "./explainerPanel";
import { buildBrandTile, prependBrand, type BrandId } from "./brandIcons";
import { REPORT_ENDPOINT } from "../shared/reportEndpoint";
import { optionalFlowsOn } from "../shared/networkFlows";
import { initSettingsSearch, revealSetting } from "./settingsSearch";
import { initNavMode } from "./navMode";
import { TOPICS, initHelpPanel } from "./helpPanel";
import { LIST_LABELS, SECTION_TITLES, groupLists } from "./filterListLabels";
import { buildKpi, buildTopCard, buildWeekChart, changePercent, type DayColumn } from "./overviewView";
import { buildHeatmap, buildPurposes, buildReachRows, busiestPhrase, purposeLabel, purposeShares } from "./insightsView";
import { createSavedToast } from "./savedToast";
import { getCustomRuleStats } from "../background/customRuleStats";
import { getLastBackupAt, recordBackupTaken } from "../background/backupStats";
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
  SaveCosmeticRuleMessage,
  SaveGrayscaleRuleMessage,
  Settings,
  SettingsPatchField,
  SetPerSiteOverrideMessage,
  SetSettingsPatchMessage,
  StartElementPickerMessage,
  StartElementPickerResponse,
  ToggleSiteMessage,
  UsageSignal,
  UsageSummaryResponse,
} from "../types";
import { STORAGE_KEY } from "../types";
import { joinCompanyBreakdown, type CompanyInfo } from "./trackerView";
import { OVERRIDE_NAMES, siteOverrideEntries, type SiteOverrideEntry } from "./siteOverrides";
import { describeSelector, type RuleKind } from "./ruleLabel";
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

async function saveCosmeticRule(hostname: string, selector: string): Promise<void> {
  const message: SaveCosmeticRuleMessage = { type: "save-cosmetic-rule", hostname, selector };
  await browser.runtime.sendMessage(message);
}

async function saveGrayscaleRule(hostname: string, selector: string): Promise<void> {
  const message: SaveGrayscaleRuleMessage = { type: "save-grayscale-rule", hostname, selector };
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
const explainerPanel = initExplainerPanel(document, tFallback);
// The filter list rows start open: every width now has the screen to itself.
(document.getElementById("filter-lists-more") as HTMLDetailsElement | null)?.setAttribute("open", "");
// Problem reports only appear as a data flow in builds that can send them.
(document.getElementById("flow-reports") as HTMLElement | null)?.toggleAttribute("hidden", !REPORT_ENDPOINT);
// Who receives each About data flow, by logo as well as name.
for (const [flow, brand] of [["updates", "github"], ["breach", "haveibeenpwned"]] as const) {
  const to = document.querySelector<HTMLElement>(`.flow-row[data-flow="${flow}"] .flow-to`);
  if (to) prependBrand(to, brand);
}
initDashboard(window, explainerPanel.showScreen);
const helpPanel = initHelpPanel(document, {
  t: tFallback,
  currentScreen: () => pageFromHash(window.location.hash),
  report: () => void browser.tabs.create({ url: browser.runtime.getURL("report.html") }),
  docsUrl: "https://samuelabhinav37.github.io/moat/#faq",
  testPageUrl: "https://d3ward.github.io/toolz/adblock.html",
});
initNavMode(window, {
  collapse: tFallback("navCollapse", "Collapse menu"),
  expand: tFallback("navExpand", "Expand menu"),
  open: tFallback("navOpen", "Menu"),
  close: tFallback("navClose", "Close menu"),
});

// ---------- Search settings and the "Saved" toast ----------

initSettingsSearch(
  document.getElementById("settings-search") as HTMLInputElement,
  document.getElementById("search-results") as HTMLUListElement,
  {
    noResults: tFallback("searchNoResults", "No settings match."),
    translate: tFallback,
    extraItems: () =>
      TOPICS.map((topic) => ({
        title: tFallback(topic.title[0], topic.title[1]),
        detail: tFallback(topic.sub[0], topic.sub[1]),
        where: tFallback("settingsHelp", "Help"),
        page: pageFromHash(window.location.hash),
        target: document.body,
        open: () => helpPanel.openTopic(topic.id),
      })),
  }
);

const savedToast = createSavedToast(
  document.getElementById("saved-toast") as HTMLElement,
  document.getElementById("saved-toast-label") as HTMLElement,
  document.getElementById("saved-toast-action") as HTMLButtonElement
);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) savedToast.settingsChanged(tFallback("toastSaved", "Saved"));
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
  /** A reassuring detail, shown in plain text rather than the caution color. */
  noteKey?: readonly [string, string];
  /** Logos of the sites this setting acts on, shown in place of the line icon. */
  brands?: BrandId[];
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
    titleKey: ["optionsCookiesToggleLabel", "Block cross-site cookies"],
    descKey: [
      "optionsCookiesToggleHint",
      "Stops sites following you from one website to the next.",
    ],
  },
  {
    id: "webrtc",
    settingKey: "webrtcLeakProtection",
    group: "privacy",
    titleKey: ["optionsWebrtcToggleLabel", "Keep your IP address private"],
    descKey: [
      "optionsWebrtcToggleHint",
      "Stops pages finding your real IP address through video-call features, even behind a VPN.",
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
      "Makes it harder for sites to recognize your device.",
    ],
    cautionKey: [
      "optionsFingerprintCaution",
      "Can occasionally break a CAPTCHA or a bank's device check. If a site misbehaves, turn this off first.",
    ],
    metricLabelKey: ["optionsFingerprintMetricLabel", "sites that saw a disguised device this week"],
  },
  {
    id: "cname",
    settingKey: "cnameUncloaking",
    group: "privacy",
    signal: "cnameUncloak",
    evidenceUnit: "week",
    titleKey: ["optionsCnameToggleLabel", "Catch hidden trackers"],
    descKey: [
      "optionsCnameDrawerDesc",
      "Finds trackers that hide behind a website's own address.",
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
    brands: ["youtube"],
    group: "annoyances",
    signal: "grayscaleAds",
    evidenceUnit: "today",
    titleKey: ["optionsGrayscaleToggleLabel", "Dim YouTube ads"],
    descKey: [
      "optionsGrayscaleToggleHint",
      "Video ads Moat can't block are dimmed while they play.",
    ],
    metricLabelKey: ["optionsGrayscaleMetricLabel", "ads dimmed today"],
  },
  {
    id: "feedScan",
    settingKey: "aggressiveFeedAdRemoval",
    brands: ["instagram", "youtube"],
    group: "annoyances",
    signal: "feedAdRemoval",
    evidenceUnit: "week",
    titleKey: ["optionsFeedScanToggleLabel", "Hide sponsored posts"],
    descKey: [
      "optionsFeedScanToggleHint",
      "Removes sponsored posts from Instagram, LinkedIn and YouTube feeds.",
    ],
    metricLabelKey: ["optionsFeedScanMetricLabel", "posts hidden this week"],
  },
  {
    id: "consentReject",
    settingKey: "cookieBannerAutoReject",
    group: "annoyances",
    signal: "cookieBannerReject",
    evidenceUnit: "week",
    titleKey: ["optionsConsentRejectToggleLabel", "Reject cookie banners"],
    descKey: ["optionsConsentRejectToggleHint", "Picks the option that shares the least, so you don't have to."],
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
      "Filters known content-farm sites out of your search results.",
    ],
    noteKey: [
      "optionsSearchSlopCaution",
      "Each hidden batch stays one click away behind a \"Show\" link.",
    ],
    metricLabelKey: ["optionsSearchSlopMetricLabel", "results hidden this week"],
  },
  {
    id: "leakedPassword",
    settingKey: "leakedPasswordCheck",
    group: "safety",
    signal: "leakedPasswordCheck",
    evidenceUnit: "week",
    titleKey: ["optionsLeakedPasswordToggleLabel", "Warn about leaked passwords"],
    descKey: ["optionsLeakedPasswordDrawerDesc", "Tells you if a password you type has appeared in a data breach."],
    noteKey: ["optionsLeakedPasswordCaution", "Only a short scrambled piece of it is ever checked."],
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

// Blocking level's "Annoyances": the page-clutter fixes, the code's own
// `annoyances` group. Every other row lives on Privacy.
const FEATURE_IDS = ["consentReject", "grayscale", "feedScan", "searchSlop"] as const;

// Privacy, split into three groups so a long screen reads as a few short
// lists. Rows a browser doesn't have (the Firefox-only ones) just drop out.
const PRIVACY_GROUPS: { key: string; fallback: string; ids: string[] }[] = [
  { key: "privacyGroupTracking", fallback: "Tracking", ids: ["cookies", "cname", "firefoxFirstPartyIsolate"] },
  { key: "privacyGroupDevice", fallback: "Your device", ids: ["fingerprint", "firefoxResistFingerprinting", "webrtc"] },
  { key: "privacyGroupPermissions", fallback: "Permissions and passwords", ids: ["permissionGuard", "leakedPassword"] },
];

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
  // Filter lists (filterListLabels.ts). Prefixed so none picks up a row's "How it works" picture.
  "list-ad": ["M4 10.5v3a1.5 1.5 0 0 0 1.5 1.5H7l8 4.5V4.5L7 9H5.5A1.5 1.5 0 0 0 4 10.5Z", "M18.5 9.5a3.5 3.5 0 0 1 0 5"],
  "list-popup": ["M8 4.5h10a2 2 0 0 1 2 2v8", "M5.5 8.5h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M3.5 12.5h13"],
  "list-globe": ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z", "M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"],
  "list-tracker": ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z", "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z", "m12 12 5.5-5.5"],
  "list-link": ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  "list-phishing": ["M8 15a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M10.5 12.5 19 4M16 7l2 2M13.8 9.2l2 2"],
  "list-scam": ["M12 4l9 16H3z", "M12 10v4M12 17v.3"],
  "list-malware": ["M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6z", "M9.5 9.5l5 5M14.5 9.5l-5 5"],
  "list-download": ["M12 4v11M7 10l5 5 5-5M5 20h14"],
  "list-cookie": ["M20.5 12.5A8.5 8.5 0 1 1 11.5 3.5a3 3 0 0 0 4 3.8 3 3 0 0 0 5 5.2Z", "M9 10h.01M13.5 15h.01M8.5 15h.01"],
  "list-social": ["M7.5 10.5V20h-3v-9.5zM7.5 10.5 11 3.5a2 2 0 0 1 2 2v4h5.2a2 2 0 0 1 2 2.3l-1.1 6.5a2 2 0 0 1-2 1.7H7.5"],
  "list-promo": ["M4 5h16v11H9l-5 4z"],
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
  brands?: BrandId[];
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
  // Rows with a "How it works" picture get a small info button after the
  // title: it opens the drawer on desktop, or the picture inside the row on
  // phones (explainerPanel.ts).
  const scene = helpSceneFor(options.icon);
  const explainer = scene ? buildExplainer(scene, options.title, tFallback) : null;
  if (explainer) {
    row.dataset.explain = scene!;
    const line = document.createElement("span");
    line.className = "title-line";
    line.append(title, explainer.button);
    text.append(line);
  } else {
    text.append(title);
  }
  if (options.desc) {
    const desc = document.createElement("span");
    desc.className = "setting-desc";
    desc.textContent = options.desc;
    text.append(desc);
  }
  if (options.extra) text.append(...options.extra);
  if (explainer) text.append(explainer.body);
  row.append(options.brands?.length ? buildBrandTile(document, options.brands) : buildIcon(options.icon), text);
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

const featureRowsEl = document.getElementById("feature-rows") as HTMLElement;
const protectionGroupsEl = document.getElementById("protection-groups") as HTMLElement;

const cnameUnsupportedHint = tFallback("optionsCnameUnsupportedHint", "Not available in this browser.");
const cnameChromeDohHint = tFallback(
  "optionsCnameChromeDohHint",
  "On Chrome, Moat asks Cloudflare where hidden trackers really point. It can miss the first one on a site. Firefox does this privately by itself."
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
    `Couldn't sync your settings on ${when}. You may have more rules or sites than your browser's ` +
      `sync storage can hold. They're still saved on this device.`,
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
const longListLabels: LongListLabels = {
  search: tFallback("listSearch", "Search"),
  showAll: (count) => tFallback("listShowAll", `Show all ${count}`, String(count)),
  showFewer: tFallback("listShowFewer", "Show fewer"),
  noMatches: tFallback("listNoMatches", "No matches."),
};

/** How to put a removed entry back, and what the toast says meanwhile. */
interface UndoRemoval<T> {
  message: (item: T) => string;
  restore: (item: T) => Promise<unknown>;
}

function offerUndo<T>(undo: UndoRemoval<T> | undefined, item: T, rerenderSelf: () => Promise<void>): void {
  if (!undo) return;
  savedToast.offerUndo(undo.message(item), tFallback("toastUndo", "Undo"), () => {
    void undo.restore(item).then(rerenderSelf);
  });
}

// Chrome only: the manifest asks for "favicon" there (see siteIcon.ts).
const faviconsSupported = (browser.runtime.getManifest().permissions ?? []).includes("favicon");
const siteIcon = (hostname: string) =>
  buildSiteIcon(document, hostname, faviconUrl(hostname, (path) => browser.runtime.getURL(path), faviconsSupported));

/** Acting on several selected rows at once: the button's wording and what
 * the toast says afterwards. */
interface BulkRemoval {
  labels: BulkLabels;
  done: (count: number) => string;
}

function renderRows<T>(
  list: HTMLUListElement,
  emptyState: HTMLElement,
  items: T[],
  formatLabel: (item: T) => string,
  removeLabel: string,
  onRemove: (item: T) => Promise<unknown>,
  rerenderSelf: () => Promise<void>,
  undo?: UndoRemoval<T>,
  bulk?: BulkRemoval,
  withIcons = false
): void {
  emptyState.style.display = items.length ? "none" : "";
  const rows = items.map((item) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = formatLabel(item);
    li.dataset.search = label.textContent;

    const remove = document.createElement("button");
    remove.textContent = removeLabel;
    remove.addEventListener("click", async () => {
      await onRemove(item);
      await rerenderSelf();
      offerUndo(undo, item, rerenderSelf);
    });

    if (withIcons) li.append(siteIcon(label.textContent));
    li.append(label, remove);
    return li;
  });
  list.replaceChildren(...rows);
  applyLongList(list, longListLabels);
  if (!bulk) return;
  const keys = items.map(formatLabel);
  applyBulkSelect(list, rows, keys, bulk.labels, async (chosenKeys) => {
    const chosen = items.filter((_, i) => chosenKeys.includes(keys[i]!));
    for (const item of chosen) await onRemove(item);
    await rerenderSelf();
    if (!undo) return;
    savedToast.offerUndo(bulk.done(chosen.length), tFallback("toastUndo", "Undo"), () => {
      void (async () => {
        for (const item of chosen) await undo.restore(item);
        await rerenderSelf();
      })();
    });
  });
}

function renderDomainList(
  list: HTMLUListElement,
  emptyState: HTMLElement,
  domains: string[],
  removeLabel: string,
  onRemove: (domain: string) => Promise<void>,
  rerenderSelf: () => Promise<void>,
  undo?: UndoRemoval<string>,
  bulk?: BulkRemoval
): void {
  // By name, ignoring a leading "www.", so www.amazon.com sits with the a's.
  const bare = (domain: string) => domain.replace(/^www\./i, "");
  const sorted = [...domains].sort((a, b) => bare(a).localeCompare(bare(b)));
  renderRows(list, emptyState, sorted, (domain) => domain, removeLabel, onRemove, rerenderSelf, undo, bulk, true);
}

const bulkLabelsFor = (action: (count: number) => string): BulkLabels => ({
  selectAll: tFallback("bulkSelectAll", "Select all"),
  selectRow: (label) => tFallback("bulkSelectRow", `Select ${label}`, label),
  selected: (count) => tFallback("bulkSelected", `${count} selected`, String(count)),
  action,
});
const bulkResume: BulkRemoval = {
  labels: bulkLabelsFor((count) => tFallback("bulkResume", `Resume ${count}`, String(count))),
  done: (count) => tFallback("toastResumedMany", `Resumed ${count} sites`, String(count)),
};
const bulkRemove: BulkRemoval = {
  labels: bulkLabelsFor((count) => tFallback("bulkRemove", `Remove ${count}`, String(count))),
  done: (count) => tFallback("toastRemovedMany", `Removed ${count} sites`, String(count)),
};

// ---------- Changed for one site ----------

const overrideList = document.getElementById("override-list") as HTMLUListElement;
const overrideEmpty = document.getElementById("override-empty") as HTMLElement;

async function setSiteOverrides(entry: SiteOverrideEntry, restore: boolean): Promise<void> {
  for (const { key, value } of entry.changes) {
    const message: SetPerSiteOverrideMessage = {
      type: "set-per-site-override",
      hostname: entry.hostname,
      key,
      value: restore ? value : null,
    };
    await browser.runtime.sendMessage(message);
  }
}

/** One row per site: its icon and name, what was changed there ("Block
 * fingerprinting: Off"), and Reset, which puts every setting on that site
 * back to the usual one (with Undo). */
function renderSiteOverrides(settings: Settings): void {
  const entries = siteOverrideEntries(settings.perSiteOverrides);
  overrideEmpty.style.display = entries.length ? "none" : "";
  const on = tFallback("commonOn", "on");
  const off = tFallback("commonOff", "off");
  overrideList.replaceChildren(
    ...entries.map((entry) => {
      const li = document.createElement("li");
      li.dataset.search = entry.hostname;
      const text = document.createElement("div");
      const host = document.createElement("span");
      host.textContent = entry.hostname;
      const changes = document.createElement("span");
      changes.className = "override-changes";
      changes.textContent = entry.changes
        .map(({ key, value }) => `${tFallback(OVERRIDE_NAMES[key][0], OVERRIDE_NAMES[key][1])}: ${value ? on : off}`)
        .join(" · ");
      text.append(host, changes);
      const reset = document.createElement("button");
      reset.textContent = tFallback("popupOverrideReset", "Reset");
      reset.setAttribute("aria-label", tFallback("overridesResetSite", `Reset ${entry.hostname}`, entry.hostname));
      reset.addEventListener("click", async () => {
        await setSiteOverrides(entry, false);
        await render();
        savedToast.offerUndo(tFallback("toastReset", `Reset ${entry.hostname}`, entry.hostname), tFallback("toastUndo", "Undo"), () => {
          void setSiteOverrides(entry, true).then(() => render());
        });
      });
      li.append(siteIcon(entry.hostname), text, reset);
      return li;
    })
  );
  applyLongList(overrideList, longListLabels);
}

const undoResume: UndoRemoval<string> = {
  message: (hostname) => tFallback("toastResumed", `Moat is back on for ${hostname}`, hostname),
  restore: (hostname) => setSiteDisabled(hostname, true),
};

function undoRemoveDomain(field: CustomDomainListField): UndoRemoval<string> {
  return {
    message: (domain) => tFallback("toastRemoved", `Removed ${domain}`, domain),
    restore: (domain) => sendAddCustomDomain(field, domain),
  };
}

interface RuleEntry {
  hostname: string;
  selector: string;
}

function undoRemoveRule(restore: (hostname: string, selector: string) => Promise<void>): UndoRemoval<RuleEntry> {
  return {
    message: (rule) => tFallback("toastRuleRemoved", `Removed an element on ${rule.hostname}`, rule.hostname),
    restore: (rule) => restore(rule.hostname, rule.selector),
  };
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
    else if (chromeSupported) {
      const hint = buildLine("setting-desc", cnameChromeDohHint);
      prependBrand(hint, "cloudflare");
      extra.push(hint);
    }
  }
  if (def.cautionKey) extra.push(buildLine("setting-caution", tFallback(...def.cautionKey)));
  if (def.noteKey) extra.push(buildLine("setting-note", tFallback(...def.noteKey)));
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
    brands: def.brands,
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

/** A labelled group of setting rows in its own inset box (Protection page). */
function buildInsetGroup(title: string, rows: HTMLElement[], note?: string): HTMLElement {
  const group = document.createElement("div");
  group.className = "pgroup";
  const heading = document.createElement("p");
  heading.className = "sub-h";
  heading.textContent = title;
  if (note) {
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = note;
    heading.append(n);
  }
  const box = document.createElement("div");
  box.className = "setting-rows inset";
  box.append(...rows);
  group.append(heading, box);
  return group;
}

function renderProtectionGroups(settings: Settings, usage: UsageSummaryResponse): void {
  featureRowsEl.replaceChildren(
    ...FEATURE_IDS.map((id) => VISIBLE_PROTECTIONS.find((def) => def.id === id))
      .filter((def): def is ProtectionDef => def !== undefined)
      .map((def) => buildProtectionRow(def, settings, usage))
  );

  const privacyRows: HTMLElement[] = [];
  for (const group of PRIVACY_GROUPS) {
    const rows: HTMLElement[] = [];
    for (const id of group.ids) {
      if (id === "permissionGuard") {
        rows.push(buildPermissionGuardRow(settings));
        continue;
      }
      const def = VISIBLE_PROTECTIONS.find((d) => d.id === id);
      if (!def) continue;
      rows.push(buildProtectionRow(def, settings, usage));
      if (def.id === "fingerprint" && settings.fingerprintResistance) rows.push(buildFingerprintRotateRow(settings));
    }
    if (!rows.length) continue;
    privacyRows.push(buildInsetGroup(tFallback(group.key, group.fallback), rows));
  }
  protectionGroupsEl.replaceChildren(...privacyRows);
}

async function renderProtectionTab(settings: Settings): Promise<void> {
  const usage = await getUsageSummary();
  lastSettings = settings;
  lastUsage = usage;

  renderProtectionGroups(settings, usage);
}

function renderLiveStatus(
  status: Awaited<ReturnType<typeof getLiveUpdateStatus>>,
  youtubeStatus?: Awaited<ReturnType<typeof getYoutubeQuickFixesStatus>>
): void {
  renderOverviewListsAge(status);
  if (!liveStatus) return;
  if (!status) {
    liveStatus.textContent = tFallback("optionsLiveStatusNotChecked", "Not checked yet.");
    return;
  }
  const when = new Date(status.timestamp).toLocaleString();
  if (!status.ok) {
    liveStatus.textContent = tFallback(
      "optionsLiveStatusFailed",
      `The last update failed on ${when}. Moat keeps using the lists it has until the next try.`,
      [when]
    );
    return;
  }
  let text = tFallback("optionsLiveStatusOk", `Last updated ${when}. Covers ${status.domainCount} sites.`, [
    when,
    String(status.domainCount),
  ]);
  if (status.quickFixCount) {
    text += tFallback("optionsLiveStatusQuickFixes", ` Extra fixes: ${status.quickFixCount}.`, [
      String(status.quickFixCount),
    ]);
  }
  if (status.cosmeticFixCount) {
    text += tFallback("optionsLiveStatusCosmeticFixes", ` Layout fixes: ${status.cosmeticFixCount}.`, [
      String(status.cosmeticFixCount),
    ]);
  }
  if (youtubeStatus?.ok && youtubeStatus.selectorCount) {
    text += tFallback(
      "optionsLiveStatusYoutubeFixes",
      ` YouTube fixes: ${youtubeStatus.selectorCount}.`,
      [String(youtubeStatus.selectorCount)]
    );
  }
  liveStatus.textContent = text;
}

/** "Lists updated 3 hours ago" on Overview's status line. */
let overviewLiveStatus: Awaited<ReturnType<typeof getLiveUpdateStatus>> = null;
let overviewSettings: Settings | null = null;
const ovStatus = document.getElementById("ov-status") as HTMLElement;
const ovStatusAction = document.getElementById("ov-status-action") as HTMLButtonElement;

/** The banner says what is true now: on (with level, list age and paused
 * sites), off, or on but with lists that failed to update. Each problem
 * state has one button that fixes it. */
function renderOverviewStatus(): void {
  if (!overviewSettings) return;
  const state = !overviewSettings.enabled ? "off" : overviewLiveStatus && !overviewLiveStatus.ok ? "failed" : "on";
  ovStatus.dataset.state = state;
  const title = document.getElementById("ov-status-title") as HTMLElement;
  const msg = document.getElementById("ov-status-msg") as HTMLElement;
  msg.hidden = ovStatusAction.hidden = state === "on";
  if (state === "on") {
    title.textContent = tFallback("ovStatusOn", "Protection is on");
    const paused = overviewSettings.disabledSites.length;
    const pausedEl = document.getElementById("ov-status-paused") as HTMLElement;
    pausedEl.hidden = (document.getElementById("ov-status-paused-sep") as HTMLElement).hidden = paused === 0;
    pausedEl.textContent =
      paused === 1 ? tFallback("ovStatusPausedOne", "Paused on 1 site") : tFallback("ovStatusPausedMany", `Paused on ${paused} sites`, String(paused));
  } else if (state === "off") {
    title.textContent = tFallback("ovStatusOff", "Protection is off.");
    msg.textContent = tFallback("ovStatusOffMsg", "Ads and trackers load on every site.");
    ovStatusAction.textContent = tFallback("ovStatusTurnOn", "Turn on");
  } else {
    title.textContent = tFallback("ovStatusFailed", "Lists couldn't update.");
    msg.textContent = tFallback("ovStatusFailedMsg", "Moat is still blocking with the lists it has.");
    ovStatusAction.textContent = tFallback("ovStatusRetry", "Try again");
  }
}

ovStatusAction.addEventListener("click", async () => {
  if (ovStatus.dataset.state === "off") {
    await setSettings({ enabled: true });
    await render();
  } else {
    await checkForFixes(ovStatusAction);
  }
});

function renderOverviewListsAge(status: Awaited<ReturnType<typeof getLiveUpdateStatus>>): void {
  overviewLiveStatus = status;
  renderOverviewStatus();
  const el = document.getElementById("ov-status-lists");
  const sep = document.getElementById("ov-status-lists-sep");
  if (!el || !sep) return;
  const show = !!status?.ok;
  el.hidden = sep.hidden = !show;
  if (!show) return;
  const minutes = Math.round((status!.timestamp - Date.now()) / 60_000);
  const rel = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const when = Math.abs(minutes) < 60 ? rel.format(minutes, "minute") : Math.abs(minutes) < 1440 ? rel.format(Math.round(minutes / 60), "hour") : rel.format(Math.round(minutes / 1440), "day");
  el.textContent = tFallback("ovListsUpdated", `Lists updated ${when}`, when);
}

// ---------- Filter Lists tab ----------

const levelLineText = document.getElementById("level-line-text") as HTMLElement;
const levelLineChange = document.getElementById("level-line-change") as HTMLAnchorElement;
const levelLineReset = document.getElementById("level-line-reset") as HTMLButtonElement;
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
  // The three levels say exactly what their Blocking level cards say.
  lite: {
    key: "levelLightDesc",
    fallback: "Blocks ads, pop-ups, and scam and malware sites. Trackers still load, so sites that depend on them keep working.",
  },
  essential: { key: "presetHintEssential", fallback: "Ads, popups, and known-malicious sites." },
  standard: { key: "levelBalancedDesc", fallback: "Everything in Light, plus trackers, tracking added to links, and phishing sites. Recommended." },
  strict: {
    key: "levelStrictDesc",
    fallback: "Everything in Balanced, plus cookie notices, social buttons, fingerprinting and third-party cookies. A few sites may not work right.",
  },
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

// Read by the About section's "rules" line. Filter entries, not Chrome
// rules: packing (scripts/pack-rules.mjs) stores many domains per rule, so
// the rule count says how much of Chrome's budget Moat uses, and the entry
// count says how much it blocks.
let activeRuleCountText = "—";

// Firefox gives each extension 30,000 static rules of its own instead of a
// share of a larger pool, so Moat turns on the most important lists that
// fit (background/filterGroups.ts).
const FIREFOX_STATIC_RULE_LIMIT = 30_000;

function renderFilterBudget(settings: Settings, lists: ReturnType<typeof summarizeFilterLists>, droppedGroups: Set<string>): void {
  const state = effectiveFilterGroupState(
    settings.enabled,
    settings.filterGroups,
    lists.map((list) => list.group)
  );
  // What's really on: the lists the user wants, minus any left out for space.
  const active = lists.filter((list) => state[list.group] && !droppedGroups.has(list.group));
  const activeRuleCount = active.reduce((sum, list) => sum + list.ruleCount, 0);
  const budgetText = activeRuleCount.toLocaleString();
  activeRuleCountText = active.reduce((sum, list) => sum + list.entryCount, 0).toLocaleString();

  // Entries (what the lists contain, and what About shows) vs rules (what
  // they're packed into for Chrome), said together so the two numbers never
  // look like they disagree.
  const limit = isFirefoxPrivacyWebsitesSupported ? FIREFOX_STATIC_RULE_LIMIT : CHROME_GLOBAL_STATIC_RULE_LIMIT;
  document.getElementById("filters-budget-line")!.textContent = isFirefoxPrivacyWebsitesSupported
    ? tFallback(
        "advBudgetLineFirefox",
        `Firefox lets each extension use ${limit.toLocaleString()} blocking rules. Moat packs ${activeRuleCountText} filter entries into ${budgetText} of them and turns on the most important lists that fit.`,
        [limit.toLocaleString(), budgetText, activeRuleCountText]
      )
    : tFallback(
        "advBudgetLine",
        `Chrome lets all your extensions use ${limit.toLocaleString()} blocking rules in total. Moat packs its ${activeRuleCountText} filter entries into ${budgetText} of them.`,
        [limit.toLocaleString(), budgetText, activeRuleCountText]
      );
  const percent = Math.min(100, Math.round((activeRuleCount / limit) * 100));
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

const levelNoteText = levelNote.querySelector("span") as HTMLElement;

// Names for the parts of a level that a hand-picked mix can change.
const PRIVACY_NAMES: Record<string, [string, string]> = {
  blockThirdPartyCookies: ["optionsCookiesToggleLabel", "Block cross-site cookies"],
  webrtcLeakProtection: ["optionsWebrtcToggleLabel", "Keep your IP address private"],
  fingerprintResistance: ["optionsFingerprintToggleLabel", "Stop sites recognizing your device"],
};

function levelName(level: string): string {
  return document.querySelector(`#level-cards .level[data-level="${level}"] .level-name`)?.textContent ?? level;
}

/** "Balanced + Social buttons − Trackers": the nearest level and what differs from it. */
function mixDescription(settings: Settings): { base: PresetName; text: string } {
  const diff = presetDifference(settings);
  const name = (key: string): string => {
    const list = LIST_LABELS[key];
    if (list) return tFallback(list.nameKey, list.name);
    const privacy = PRIVACY_NAMES[key];
    return privacy ? tFallback(privacy[0], privacy[1]) : key;
  };
  const parts = [levelName(diff.base), ...diff.added.map((key) => `+ ${name(key)}`), ...diff.removed.map((key) => `− ${name(key)}`)];
  return { base: diff.base, text: parts.join(" ") };
}

function renderLevels(preset: PresetName | "custom", locked: boolean, settings: Settings): void {
  for (const card of levelCards) {
    card.setAttribute("aria-checked", String(card.dataset.level === preset));
    card.disabled = locked;
  }
  levelNote.hidden = (MAIN_LEVELS as readonly string[]).includes(preset) || preset === "off";
  if (!levelNote.hidden && preset === "custom") {
    const mix = mixDescription(settings).text;
    levelNoteText.textContent = tFallback("filtersLevelMix", `Your mix: ${mix}.`, mix);
  }
}

for (const card of levelCards) {
  card.addEventListener("click", async () => {
    await setSettings(presetPatch(card.dataset.level as PresetName));
    await render();
  });
}

async function renderFilterLists(settings: Settings, droppedGroups: Set<string>): Promise<void> {
  // Before the list manifest loads, so the level shows even if it can't.
  const preset = detectPreset(settings);
  renderLevelLine(preset, settings);
  const manifest = await loadRulesetManifest();
  if (!manifest) {
    const loadError = tFallback("optionsLoadListsError", "Couldn't load filter lists. Reload this page to try again.");
    presetHint.textContent = loadError;
    const error = document.createElement("p");
    error.className = "empty-state";
    error.textContent = loadError;
    filterListRows.replaceChildren(error);
    return;
  }
  const lists = summarizeFilterLists(manifest);
  currentFilterGroups = settings.filterGroups;

  presetHint.textContent = tFallback(PRESET_HINTS[preset].key, PRESET_HINTS[preset].fallback);
  // The level line already says "Your own mix of lists."
  presetHint.hidden = preset === "custom";

  renderFilterBudget(settings, lists, droppedGroups);

  const matchesMessage: GetFilterListMatchesMessage = { type: "get-filter-list-matches" };
  const matches = (await browser.runtime.sendMessage(matchesMessage)) as FilterListMatchesResponse;

  const buildListRow = (list: (typeof lists)[number]): HTMLElement => {
    const titleId = `filter-list-${list.group}-label`;
    const label = LIST_LABELS[list.group];
    const matchCount = matches.matchesByGroup[list.group] ?? 0;
    const countText = tFallback("optionsRuleCount", `${list.entryCount.toLocaleString()} rules`, list.entryCount.toLocaleString());
    const matchedSuffix =
      matchCount > 0 ? tFallback("optionsFilterMatchedOnPage", ` · matched ${matchCount} times on this page`, String(matchCount)) : "";
    const extra: HTMLElement[] = [];
    // What the list stops, then its own published name as the credit.
    if (label) extra.push(buildLine("setting-desc credit", `${list.name} · ${countText}${matchedSuffix}`));
    // The toggle reflects what the user *asked for* (settings.filterGroups),
    // which isn't necessarily what's enabled in Chrome right now -- a list
    // the shared rule budget kept off gets a visible badge on its own row
    // (see applyFilterGroupState's drop-priority retry in
    // background/filterGroups.ts).
    if (droppedGroups.has(list.group)) {
      extra.push(buildLine("locked-badge budget-badge", tFallback("optionsFilterBudgetDroppedBadge", "Off to stay within the browser limit")));
    }
    const on = settings.filterGroups[list.group] ?? true;
    const control = buildSwitch(on, titleId, (checked) => {
      const updated = { ...(currentFilterGroups ?? settings.filterGroups), [list.group]: checked };
      currentFilterGroups = updated;
      void setSettings({ filterGroups: updated }).then(() => render());
    });
    return buildSettingRow({
      icon: label ? `list-${label.icon}` : "list",
      titleId,
      title: label ? tFallback(label.nameKey, label.name) : list.name,
      desc: label ? tFallback(label.descKey, label.desc) : countText + matchedSuffix,
      on,
      extra,
      control,
    });
  };
  filterListRows.replaceChildren(
    ...groupLists(lists).map(({ section, lists: inSection }) => {
      const onCount = inSection.filter((l) => settings.filterGroups[l.group] ?? true).length;
      const title = SECTION_TITLES[section];
      return buildInsetGroup(
        tFallback(title.key, title.fallback),
        inSection.map(buildListRow),
        tFallback("listSectionOnCount", `${onCount} of ${inSection.length} on`, [String(onCount), String(inSection.length)])
      );
    })
  );
}

/** "Using Balanced · Change level", or for a hand-picked mix (Essential
 * included, which has no card) "Your own mix · Reset to Balanced". The level
 * itself is only chosen on Blocking level. */
function renderLevelLine(preset: PresetName | "custom", settings: Settings): void {
  const onCard = (MAIN_LEVELS as readonly string[]).includes(preset);
  if (onCard) {
    const name = levelName(preset);
    levelLineText.textContent = tFallback("filtersLevelUsing", `Using ${name}.`, name);
  } else if (preset === "custom") {
    const mix = mixDescription(settings);
    levelLineText.textContent = tFallback("filtersLevelMix", `Your mix: ${mix.text}.`, mix.text);
    levelLineReset.dataset.level = mix.base;
    levelLineReset.textContent = tFallback("filtersLevelResetTo", `Reset to ${levelName(mix.base)}`, levelName(mix.base));
  } else {
    levelLineText.textContent = tFallback("filtersLevelCustom", "Your own mix of lists.");
    levelLineReset.dataset.level = "standard";
    levelLineReset.textContent = tFallback("filtersLevelResetTo", `Reset to ${levelName("standard")}`, levelName("standard"));
  }
  levelLineChange.hidden = !onCard;
  levelLineReset.hidden = onCard;
}

levelLineReset.addEventListener("click", async () => {
  await setSettings(presetPatch((levelLineReset.dataset.level as PresetName | undefined) ?? "standard"));
  await render();
});

/** The one "Check for filter fixes" action, from Filter lists or About. */
async function checkForFixes(trigger: HTMLElement): Promise<void> {
  if (trigger.getAttribute("aria-disabled") === "true") return;
  const label = trigger.textContent;
  trigger.setAttribute("aria-disabled", "true");
  aboutCheckFixesButton.disabled = true;
  trigger.textContent = tFallback("aboutFixesChecking", "Checking…");
  versionUpdatedEl.textContent = tFallback("aboutFixesChecking", "Checking…");
  try {
    const message: CheckForLiveUpdatesMessage = { type: "check-for-live-updates" };
    await browser.runtime.sendMessage(message);
  } finally {
    trigger.textContent = label;
    trigger.removeAttribute("aria-disabled");
    aboutCheckFixesButton.disabled = false;
    await render();
  }
}

filterCheckUpdates.addEventListener("click", (event) => {
  event.preventDefault();
  void checkForFixes(filterCheckUpdates);
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
    status.textContent = tFallback("optionsAddDomainInvalid", "Enter a site address like example.com.");
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
const RULE_KIND_NAMES: Record<RuleKind, readonly [string, string]> = {
  image: ["pickerKindImage", "Image"],
  frame: ["pickerKindFrame", "Embedded frame"],
  video: ["pickerKindVideo", "Video"],
  link: ["pickerKindLink", "Link"],
  text: ["pickerKindText", "Text"],
  box: ["pickerKindBox", "Box"],
};

function ruleLabel(selector: string): string {
  const { kind, name } = describeSelector(selector);
  const kindName = tFallback(RULE_KIND_NAMES[kind][0], RULE_KIND_NAMES[kind][1]);
  return name ? tFallback("ruleLabelNamed", `${kindName} “${name}”`, [kindName, name]) : kindName;
}

function buildRuleRow(
  kind: "hide" | "gray",
  hostname: string,
  selector: string,
  stats: Record<string, CustomRuleStat>,
  onRemove: (hostname: string, selector: string) => Promise<unknown>,
  rerenderSelf: () => Promise<void>,
  undo?: UndoRemoval<RuleEntry>
): HTMLElement {
  const now = Date.now();
  const stat = stats[customRuleStatKey(kind, hostname, selector)];
  const stale = stat ? isStale(stat, now) : false;

  const row = document.createElement("div");
  row.className = "rule-row";
  row.dataset.search = `${hostname} ${selector}`;

  const main = document.createElement("div");
  main.className = "rule-main";
  // What it is in words ("Box “sponsor box”"), then the site, then the
  // selector itself in small print for anyone who wants it.
  const labelEl = document.createElement("span");
  labelEl.className = stale ? "rule-label stale" : "rule-label";
  labelEl.textContent = ruleLabel(selector);
  const siteEl = document.createElement("span");
  siteEl.className = "rule-site";
  siteEl.append(siteIcon(hostname), document.createTextNode(hostname));
  const selectorEl = document.createElement("span");
  selectorEl.className = "rule-selector";
  selectorEl.textContent = selector;
  main.append(labelEl, siteEl, selectorEl);

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
    const added =
      days === 0
        ? tFallback("optionsRuleAddedToday", "Added today")
        : days === 1
          ? tFallback("optionsRuleAddedYesterday", "Added yesterday")
          : tFallback("optionsRuleAddedDaysAgo", `Added ${days} days ago`, String(days));
    const hits =
      stat.hitCount === 0
        ? tFallback("optionsRuleHitsNone", "not seen on a page yet")
        : stat.hitCount === 1
          ? tFallback("optionsRuleHitsOnce", "hidden once since")
          : tFallback("optionsRuleHitsCount", `hidden ${stat.hitCount} times since`, String(stat.hitCount));
    meta.textContent = `${added} · ${hits}`;
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
    offerUndo(undo, { hostname, selector }, rerenderSelf);
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
  rerenderSelf: () => Promise<void>,
  undo?: UndoRemoval<RuleEntry>
): void {
  const rows = Object.entries(rules)
    .flatMap(([hostname, selectors]) => selectors.map((selector) => ({ hostname, selector })))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
  emptyState.style.display = rows.length ? "none" : "";
  container.replaceChildren(...rows.map((r) => buildRuleRow(kind, r.hostname, r.selector, stats, onRemove, rerenderSelf, undo)));
  applyLongList(container, longListLabels);
}

pickElementButton.addEventListener("click", async () => {
  pickElementStatus.hidden = true;
  const message: StartElementPickerMessage = { type: "start-element-picker" };
  const result = (await browser.runtime.sendMessage(message)) as StartElementPickerResponse;
  if (!result.ok) {
    pickElementStatus.hidden = false;
    pickElementStatus.textContent = tFallback("optionsPickElementFailed", "Couldn't start there. Moat can't run on browser pages or extension stores. Open a website and try again.");
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
      tFallback("optionsMigrationImportBlocked", `Always block: ${response.addedBlockedDomains}`, String(response.addedBlockedDomains))
    );
  }
  if (response.addedAllowedDomains > 0) {
    parts.push(
      tFallback("optionsMigrationImportAllowed", `Never block: ${response.addedAllowedDomains}`, String(response.addedAllowedDomains))
    );
  }
  if (response.addedCosmeticRules > 0) {
    parts.push(
      tFallback("optionsMigrationImportCosmetic", `Hidden items: ${response.addedCosmeticRules}`, String(response.addedCosmeticRules))
    );
  }
  const added =
    parts.length > 0
      ? tFallback("optionsMigrationImportAdded", `Imported. ${parts.join(" · ")}.`, parts.join(" · "))
      : tFallback("optionsMigrationImportNothingNew", "Nothing new to add. Every rule Moat recognized was already saved.");
  const skipped =
    skippedLines > 0
      ? " " + tFallback("optionsMigrationImportSkipped", `Lines Moat couldn't use: ${skippedLines}.`, String(skippedLines))
      : "";
  return added + skipped;
}

migrationImportButton.addEventListener("click", async () => {
  const parsed = parseFilterListImport(migrationImportTextarea.value);
  migrationImportStatus.hidden = false;
  if (parsed.blockedDomains.length === 0 && parsed.allowedDomains.length === 0 && Object.keys(parsed.cosmeticRules).length === 0) {
    migrationImportStatus.textContent = tFallback("optionsMigrationImportNothingFound", "Moat didn't recognize any rules in that text. Paste rules exported from uBlock Origin or AdGuard.");
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
// Firefox's mark stands for Mozilla's sync: Mozilla's own wordmark is
// near-black and wouldn't show on this dark page.
const SYNC_VENDOR_BRAND: BrandId = isFirefoxPrivacyWebsitesSupported ? "firefox" : "google";

const flowStateBreachEl = document.getElementById("flow-state-breach") as HTMLElement;
const flowStateSyncEl = document.getElementById("flow-state-sync") as HTMLElement;
const flowStateHiddenEl = document.getElementById("flow-state-hidden") as HTMLElement;
const aboutFlowsSummaryEl = document.getElementById("about-flows-summary") as HTMLElement;
const shortcutKeysEl = document.getElementById("shortcut-keys") as HTMLElement;
const shortcutChangeButton = document.getElementById("shortcut-change") as HTMLButtonElement;
const aboutCheckFixesButton = document.getElementById("about-check-fixes") as HTMLButtonElement;

function setFlowState(el: HTMLElement, on: boolean): void {
  el.textContent = on ? tFallback("commonOn", "on") : tFallback("commonOff", "off");
  el.classList.toggle("on", on);
}

/** The toggle shortcut as key caps, read from the browser (the user may
 * have changed it) rather than the manifest's suggestion. */
async function renderShortcut(): Promise<void> {
  let shortcut = "";
  try {
    const commands = await browser.commands.getAll();
    shortcut = commands.find((command) => command.name === "toggle-protection")?.shortcut ?? "";
  } catch {
    // No commands API here (tests, or a browser without it).
  }
  if (!shortcut) {
    shortcutKeysEl.textContent = tFallback("aboutShortcutNone", "No shortcut set");
    return;
  }
  shortcutKeysEl.replaceChildren(
    ...shortcut.split("+").map((key) => {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      return kbd;
    })
  );
}

async function renderAboutTab(policy: Awaited<ReturnType<typeof getManagedPolicy>>, settings: Settings): Promise<void> {
  const manifest = browser.runtime.getManifest();
  versionNumberEl.textContent = manifest.version;
  versionBuildEl.textContent = isFirefoxPrivacyWebsitesSupported ? tFallback("commonFirefox", "Firefox") : tFallback("commonChrome", "Chrome");
  // Same number the Filter lists budget line shows -- render() computes it
  // before this runs, so the two can never disagree.
  versionRulesEl.textContent = activeRuleCountText;
  const liveUpdateStatus = await getLiveUpdateStatus();
  versionUpdatedEl.textContent = liveUpdateStatus
    ? tFallback(
        "aboutFixesLast",
        `Last downloaded ${new Date(liveUpdateStatus.timestamp).toLocaleDateString()}`,
        new Date(liveUpdateStatus.timestamp).toLocaleDateString()
      )
    : tFallback("aboutFixesNever", "Not downloaded yet");

  // Current state, not the install default: this is what is being sent now.
  setFlowState(flowStateBreachEl, settings.leakedPasswordCheck);
  setFlowState(flowStateSyncEl, settings.syncEnabled);
  setFlowState(flowStateHiddenEl, !isFirefoxPrivacyWebsitesSupported && settings.cnameUncloaking);
  // Firefox resolves hidden trackers with its own DNS, so nobody new receives anything there.
  (document.getElementById("flow-hidden") as HTMLElement).hidden = isFirefoxPrivacyWebsitesSupported;
  (document.getElementById("flow-org") as HTMLElement).hidden = !policy.athena;
  const flowContext = { firefox: isFirefoxPrivacyWebsitesSupported, managed: !!policy.athena, reports: !!REPORT_ENDPOINT };
  aboutFlowsSummaryEl.textContent =
    optionalFlowsOn(settings, flowContext).length > 0
      ? tFallback("aboutFlowsSome", "A feature you turned on sends a little data. Each one is listed below.")
      : tFallback("aboutFlowsNothing", "With your current settings, nothing about your browsing leaves your device.");

  // "Change: Settings sync", read after the page's text is translated.
  for (const button of document.querySelectorAll<HTMLButtonElement>("#about-flows .flow-change")) {
    const name = button.closest(".flow-row")?.querySelector(".flow-text b")?.textContent ?? "";
    button.setAttribute("aria-label", `${button.textContent}: ${name}`);
  }
  disclosureSyncRecipientEl.textContent = SYNC_VENDOR_NAME;
  prependBrand(disclosureSyncRecipientEl, SYNC_VENDOR_BRAND);
  managedNotice.hidden = Object.keys(policy).length === 0;
  await renderShortcut();
}

aboutCheckFixesButton.addEventListener("click", () => void checkForFixes(aboutCheckFixesButton));

// "Change" on an optional connection jumps to the switch that controls it.
for (const button of document.querySelectorAll<HTMLButtonElement>("#about-flows .flow-change")) {
  button.addEventListener("click", () => {
    const title = document.getElementById(button.dataset.reveal ?? "");
    const row = title?.closest<HTMLElement>(".setting-row");
    const page = row?.closest<HTMLElement>("[data-page]")?.dataset.page;
    if (!row || !page) return;
    revealSetting(row, pageFromHash(page));
    window.setTimeout(() => row.querySelector<HTMLElement>("input, [role=switch]")?.focus({ preventScroll: true }), 120);
  });
}

// Firefox opens its own shortcut manager; Chrome's lives on an internal page
// an extension may open in a tab but a plain link can't reach. An older
// Firefox has neither, so the button goes.
const canOpenShortcuts =
  typeof (browser.commands as { openShortcutSettings?: unknown } | undefined)?.openShortcutSettings === "function" ||
  !isFirefoxPrivacyWebsitesSupported;
shortcutChangeButton.hidden = !canOpenShortcuts;
shortcutChangeButton.addEventListener("click", () => {
  const commands = browser.commands as typeof browser.commands & { openShortcutSettings?: () => Promise<void> };
  if (typeof commands.openShortcutSettings === "function") void commands.openShortcutSettings();
  else void browser.tabs.create({ url: "chrome://extensions/shortcuts" });
});

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
    rerenderSiteList,
    undoResume,
    bulkResume
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
    rerenderCustomBlockList,
    undoRemoveDomain("customBlockedDomains"),
    bulkRemove
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
    rerenderCustomAllowList,
    undoRemoveDomain("customAllowedDomains"),
    bulkRemove
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
    rerenderHiddenElementList,
    undoRemoveRule(saveCosmeticRule)
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
    rerenderGrayscaleElementList,
    undoRemoveRule(saveGrayscaleRule)
  );
  grayscaleElementBlock.hidden = Object.keys(settings.customGrayscaleRules).length === 0;
}

async function render(): Promise<void> {
  const [settings, policy] = await Promise.all([getEffectiveSettings(), getManagedPolicy()]);

  await renderProtectionTab(settings);
  if (lastUsage) {
    renderWeeklyTrackers(lastUsage);
    renderOverview(settings, lastUsage);
    void renderInsights(settings, lastUsage);
  }

  renderSyncStatus(settings.syncEnabled, await getSyncStatus());
  renderLiveStatus(await getLiveUpdateStatus(), await getYoutubeQuickFixesStatus());

  renderDomainList(
    siteList,
    siteEmptyState,
    settings.disabledSites,
    tFallback("commonResume", "Resume"),
    (hostname) => setSiteDisabled(hostname, false).then(() => undefined),
    rerenderSiteList,
    undoResume,
    bulkResume
  );

  renderSiteOverrides(settings);

  const filterGroupStatus = await getFilterGroupStatus();
  filterBudgetWarning.hidden = filterGroupStatus === null || filterGroupStatus.ok;
  if (filterGroupStatus?.droppedGroups?.length) {
    const manifest = await loadRulesetManifest();
    const namesByGroup = new Map((manifest ? summarizeFilterLists(manifest) : []).map((l) => [l.group, l.name]));
    const names = filterGroupStatus.droppedGroups.map((group) => namesByGroup.get(group) ?? group).join(", ");
    filterBudgetDetail.hidden = false;
    filterBudgetDetail.textContent = tFallback(
      "optionsFilterBudgetDropped",
      `${names} are off for now to stay within your browser's limit.`,
      [names]
    );
  } else if (filterGroupStatus?.availableStaticRuleCount !== undefined) {
    const availableCount = filterGroupStatus.availableStaticRuleCount;
    filterBudgetDetail.hidden = false;
    filterBudgetDetail.textContent = tFallback(
      "optionsFilterBudgetDetail",
      `Your browser says ${availableCount} rules are left for all your extensions together. Still low after turning off other extensions and reloading Moat? Turn off a list here. Annoyances and Cookie Notices are good ones to try first.`,
      [String(availableCount)]
    );
  } else {
    filterBudgetDetail.hidden = true;
  }

  const filtersLocked = isLocked("filterGroups", policy);
  filtersLockedBadge.hidden = !filtersLocked;
  levelLineReset.disabled = filtersLocked;
  levelLineChange.hidden = levelLineChange.hidden || filtersLocked;
  await renderFilterLists(settings, new Set(filterGroupStatus?.droppedGroups ?? []));
  for (const input of filterListRows.querySelectorAll("input")) input.disabled = filtersLocked;
  renderLevels(detectPreset(settings), filtersLocked, settings);

  renderDomainList(
    customBlockList,
    customBlockEmpty,
    settings.customBlockedDomains,
    tFallback("commonRemove", "Remove"),
    (domain) => sendRemoveCustomDomain("customBlockedDomains", domain),
    rerenderCustomBlockList,
    undoRemoveDomain("customBlockedDomains"),
    bulkRemove
  );
  renderDomainList(
    customAllowList,
    customAllowEmpty,
    settings.customAllowedDomains,
    tFallback("commonRemove", "Remove"),
    (domain) => sendRemoveCustomDomain("customAllowedDomains", domain),
    rerenderCustomAllowList,
    undoRemoveDomain("customAllowedDomains"),
    bulkRemove
  );
  const customRuleStats = await getCustomRuleStats();
  renderRuleGroup(
    "hide",
    hiddenElementRows,
    hiddenElementEmpty,
    settings.customCosmeticRules,
    customRuleStats,
    removeCustomCosmeticRule,
    rerenderHiddenElementList,
    undoRemoveRule(saveCosmeticRule)
  );
  renderRuleGroup(
    "gray",
    grayscaleElementRows,
    grayscaleElementEmpty,
    settings.customGrayscaleRules,
    customRuleStats,
    removeGrayscaleRule,
    rerenderGrayscaleElementList,
    undoRemoveRule(saveGrayscaleRule)
  );
  // The "Grayed out" block only appears once someone has actually grayed
  // something out -- most people never will, so it stays out of the way.
  grayscaleElementBlock.hidden = Object.keys(settings.customGrayscaleRules).length === 0;

  await renderBackupTab(settings);
  await renderAboutTab(policy, settings);
  explainerPanel.refresh();
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
const exportHintEl = document.getElementById("export-hint") as HTMLElement;
const backupMetricLastEl = document.getElementById("backup-metric-last") as HTMLElement;

/** "Saves moat-settings-2026-09-29.json, a plain text file you can open and
 * read." as one message, with the file name set as code where the
 * translation puts $FILE$. */
function renderExportHint(filename: string): void {
  const MARK = "\u0001";
  const sentence = tFallback("backupSavesFile", `Saves ${MARK}, a plain text file you can open and read.`, MARK);
  const [before = "", after = ""] = sentence.split(MARK);
  const code = document.createElement("code");
  code.id = "export-filename";
  code.textContent = filename;
  exportHintEl.replaceChildren(before, code, after);
}
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
  renderExportHint(exportFilename());
  syncToggle.checked = settings.syncEnabled;
  syncRecipientEl.textContent = SYNC_VENDOR_NAME;
  prependBrand(syncRecipientEl, SYNC_VENDOR_BRAND);

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
  document.getElementById("weekly-tracker-summary")!.textContent =
    usage.companiesThisWeek.length === 0
      ? tFallback("advTrackersEmptyWeek", "None yet this week. Companies show up here as Moat stops their trackers while you browse.")
      : usage.companiesThisWeek.length === 1
        ? tFallback("advTrackersSummaryOne", `Of this week's blocks, ${attempts} came from one company Moat can name.`, [attempts])
        : tFallback("advTrackersSummary", `Of this week's blocks, ${attempts} came from ${companies} companies Moat can name.`, [companies, attempts]);

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
      reach.textContent =
        company.hostnameCount === 1
          ? tFallback("optionsCompanyReachOne", "1 site")
          : tFallback("optionsCompanyReach", `${company.hostnameCount} sites`, String(company.hostnameCount));
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
  applyLongList(container, longListLabels);
}

// ---------- Overview ----------

function levelLabel(preset: PresetName | "custom"): string {
  switch (preset) {
    case "lite":
      return tFallback("presetLite", "Light");
    case "essential":
      return tFallback("presetEssential", "Essential");
    case "standard":
      return tFallback("presetStandard", "Balanced");
    case "strict":
      return tFallback("presetStrict", "Strict");
    case "off":
      return tFallback("ovLevelOff", "Off");
    default:
      return tFallback("ovLevelCustom", "Your own mix");
  }
}

/** The week at a glance, from the same local counts the Trackers list
 * reads: usage.sparkline is 7 daily totals, oldest first, ending today. */
function renderOverview(settings: Settings, usage: UsageSummaryResponse): void {
  const days = usage.sparkline.slice(-7);
  const week = days.reduce((sum, n) => sum + n, 0);
  document.getElementById("ov-week-total")!.textContent = week.toLocaleString();
  document.getElementById("ov-week-empty")!.hidden = week > 0;
  document.getElementById("ov-status-level")!.textContent = levelLabel(detectPreset(settings));
  overviewSettings = settings;
  renderOverviewStatus();

  // "85% more than last week", or how many sites, when there's no last week yet.
  const headline = document.getElementById("ov-headline")!;
  const change = changePercent(week, usage.previousWeek?.total);
  headline.replaceChildren();
  if (week > 0) {
    if (change !== null) {
      const b = document.createElement("b");
      b.textContent =
        change >= 0
          ? tFallback("ovMoreThanLastWeek", `${change}% more`, String(change))
          : tFallback("ovLessThanLastWeek", `${Math.abs(change)}% less`, String(Math.abs(change)));
      headline.append(b, document.createTextNode(` ${tFallback("ovThanLastWeek", "than last week")}`));
    } else {
      headline.textContent = tFallback("ovAcrossSites", `across ${usage.weekSiteCount} sites`, String(usage.weekSiteCount));
    }
  }

  const todayLabel = tFallback("ovToday", "Today");
  const columns: DayColumn[] = days.map((total, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (days.length - 1 - i));
    const kinds = usage.dailyKinds[i] ?? { ads: 0, trackers: 0, popups: 0 };
    const sorted = kinds.ads + kinds.trackers + kinds.popups;
    const today = i === days.length - 1;
    return {
      label: today ? todayLabel : date.toLocaleDateString(undefined, { weekday: "short" }),
      date: date.toLocaleDateString(),
      today,
      kinds,
      other: Math.max(0, total - sorted),
    };
  });
  const chart = document.getElementById("ov-chart") as HTMLElement;
  chart.replaceChildren(...(week > 0 ? [buildWeekChart(document, columns, tFallback)] : []));

  const prev = usage.previousWeek;
  const kinds = usage.weekKinds;
  document
    .getElementById("ov-kpis")!
    .replaceChildren(
      buildKpi(document, tFallback("ovKpiAds", "Ads blocked"), kinds.ads, changePercent(kinds.ads, prev?.kinds.ads), usage.dailyKinds.slice(0, 6).map((d) => d.ads), tFallback),
      buildKpi(document, tFallback("ovKpiTrackers", "Trackers blocked"), kinds.trackers, changePercent(kinds.trackers, prev?.kinds.trackers), usage.dailyKinds.slice(0, 6).map((d) => d.trackers), tFallback),
      buildKpi(document, tFallback("ovKpiPopups", "Pop-ups stopped"), kinds.popups, changePercent(kinds.popups, prev?.kinds.popups), usage.dailyKinds.slice(0, 6).map((d) => d.popups), tFallback)
    );
  void renderOverviewTops(usage);
}

/** Who tracks you most, Most blocked sites, Pages Moat stopped. */
async function renderOverviewTops(usage: UsageSummaryResponse): Promise<void> {
  const info = await loadCompanyInfo();
  const sites = Math.max(usage.weekSiteCount, 1);
  const companies = [...usage.companiesThisWeek].sort((a, b) => b.hostnameCount - a.hostnameCount || b.count - a.count).slice(0, 5);
  const companyIcon = (company: string) => {
    const url = info[company]?.url;
    let host = "";
    try {
      host = url ? new URL(url).hostname : "";
    } catch {
      host = "";
    }
    return host ? siteIcon(host) : buildSiteIcon(document, company, null);
  };
  const ofSites = tFallback("ovOfSites", `of ${sites}`, String(sites));
  const topSites = usage.topSites.slice(0, 5);
  const maxSite = Math.max(...topSites.map((s) => s.count), 1);
  const rel = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ago = (time: number) => {
    const days = Math.round((time - Date.now()) / 86_400_000);
    if (days !== 0) return rel.format(days, "day");
    const hours = Math.round((time - Date.now()) / 3_600_000);
    return hours !== 0 ? rel.format(hours, "hour") : rel.format(Math.round((time - Date.now()) / 60_000), "minute");
  };
  document.getElementById("ov-tops")!.replaceChildren(
    buildTopCard(
      document,
      tFallback("ovTopTrackersTitle", "Who tracks you most"),
      tFallback("ovTopTrackersSub", "Sites each company was on"),
      companies.map((c) => ({
        icon: companyIcon(c.company),
        name: c.company,
        value: c.hostnameCount.toLocaleString(),
        sub: ofSites,
        share: c.hostnameCount / sites,
        title: (usage.companySites[c.company] ?? []).join(", "),
      })),
      tFallback("ovTopTrackersEmpty", "No tracker companies this week yet.")
    ),
    buildTopCard(
      document,
      tFallback("ovTopSitesTitle", "Most blocked sites"),
      tFallback("ovTopSitesSub", "Ads, trackers and pop-ups stopped"),
      topSites.map((s) => ({ icon: siteIcon(s.hostname), name: s.hostname.replace(/^www\./, ""), value: s.count.toLocaleString(), share: s.count / maxSite })),
      tFallback("ovTopSitesEmpty", "Browse a few sites and they show up here.")
    ),
    buildTopCard(
      document,
      tFallback("ovTopStopsTitle", "Pages Moat stopped"),
      tFallback("ovTopStopsSub", "Whole pages that never loaded"),
      usage.pageStops.slice(0, 5).map((stop) => ({ icon: siteIcon(stop.hostname), name: stop.hostname, value: ago(stop.time), share: null })),
      tFallback("ovTopStopsEmpty", "None this week.")
    )
  );
}

// ---------- Insights: Trackers, Sites, Security ----------

function companyHost(info: Record<string, CompanyInfo>, company: string): string {
  try {
    return info[company]?.url ? new URL(info[company]!.url!).hostname : "";
  } catch {
    return "";
  }
}

function setTakeaway(id: string, parts: (string | { bold: string })[]): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.replaceChildren(
    ...parts.map((part) => {
      if (typeof part === "string") return document.createTextNode(part);
      const b = document.createElement("b");
      b.textContent = part.bold;
      return b;
    })
  );
}

async function renderInsights(settings: Settings, usage: UsageSummaryResponse): Promise<void> {
  const info = await loadCompanyInfo();
  const prev = usage.previousWeek;
  const sitesThisWeek = Math.max(usage.weekSiteCount, 1);
  const companies = [...usage.companiesThisWeek].sort((a, b) => b.hostnameCount - a.hostnameCount || b.count - a.count);

  // Trackers
  document.getElementById("t-kpis")?.replaceChildren(
    buildKpi(document, tFallback("ovKpiTrackers", "Trackers blocked"), usage.weekKinds.trackers, changePercent(usage.weekKinds.trackers, prev?.kinds.trackers), usage.dailyKinds.slice(0, 6).map((d) => d.trackers), tFallback),
    buildKpi(document, tFallback("insKpiCompanies", "Companies"), companies.length, changePercent(companies.length, prev?.companies), usage.companiesTrend.slice(0, 6), tFallback),
    buildKpi(document, tFallback("insKpiTrackerSites", "Sites with trackers"), usage.trackerSiteCount, null, [], tFallback)
  );
  const top = companies[0];
  setTakeaway(
    "t-who-take",
    top
      ? [{ bold: top.company }, ` ${tFallback("insWhoTake", `was on ${Math.round((top.hostnameCount / sitesThisWeek) * 100)}% of the sites you visited. Pick a company to see where.`, String(Math.round((top.hostnameCount / sitesThisWeek) * 100)))}`]
      : [tFallback("ovTopTrackersEmpty", "No tracker companies this week yet.")]
  );
  document.getElementById("t-who")?.replaceChildren(
    buildReachRows(
      document,
      companies.slice(0, 8).map((c) => {
        const host = companyHost(info, c.company);
        return {
          company: c.company,
          icon: host ? siteIcon(host) : buildSiteIcon(document, c.company, null),
          sites: c.hostnameCount,
          ofSites: sitesThisWeek,
          blocks: c.count,
          description: info[c.company]?.description ?? "",
          seenOn: (usage.companySites[c.company] ?? []).map((hostname) => ({ hostname, icon: siteIcon(hostname) })),
        };
      }),
      tFallback
    )
  );
  const shares = purposeShares(usage.purposes);
  setTakeaway(
    "t-what-take",
    shares[0]
      ? [{ bold: `${Math.round(shares[0].share * 100)}%` }, ` ${tFallback("insWhatTake", `were for ${purposeLabel(shares[0].category, tFallback).name.toLowerCase()}.`, purposeLabel(shares[0].category, tFallback).name.toLowerCase())}`]
      : [tFallback("insWhatEmpty", "Fills in as Moat blocks trackers.")]
  );
  document.getElementById("t-what")?.replaceChildren(...(shares.length ? [buildPurposes(document, usage.purposes, tFallback)] : []));
  const dayLabels: string[] = [];
  const weekend: boolean[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayLabels.push(i === 0 ? tFallback("ovToday", "Today") : d.toLocaleDateString(undefined, { weekday: "short" }));
    weekend.push(d.getDay() === 0 || d.getDay() === 6);
  }
  setTakeaway("t-when-take", [busiestPhrase(usage.hours, weekend, tFallback)]);
  document.getElementById("t-when")?.replaceChildren(buildHeatmap(document, usage.hours, dayLabels, tFallback));

  // Sites: blocks per site, with Moat's switch for each.
  const table = document.createElement("table");
  table.className = "ins-table";
  const headRow = document.createElement("tr");
  for (const [key, fallback, cls] of [
    ["insColSite", "Site", ""],
    ["insColBlocked", "Blocked", "hide-sm"],
    ["insColTotal", "Total", ""],
    ["insColMoat", "Moat", ""],
  ] as const) {
    const th = document.createElement("th");
    th.textContent = tFallback(key, fallback);
    if (cls) th.className = cls;
    headRow.append(th);
  }
  const thead = document.createElement("thead");
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  const maxSite = Math.max(...usage.topSites.map((x) => x.count), 1);
  for (const site of usage.topSites) {
    const row = document.createElement("tr");
    const paused = settings.disabledSites.includes(site.hostname);
    row.classList.toggle("off", paused);
    const name = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "site";
    const label = document.createElement("span");
    label.id = `site-row-${site.hostname}`;
    label.textContent = site.hostname.replace(/^www\./, "");
    wrap.append(siteIcon(site.hostname), label);
    name.append(wrap);
    const barCell = document.createElement("td");
    barCell.className = "hide-sm";
    barCell.style.width = "40%";
    const bar = document.createElement("span");
    bar.className = "ins-bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(2, (site.count / maxSite) * 100)}%`;
    bar.append(fill);
    barCell.append(bar);
    const total = document.createElement("td");
    total.className = "num";
    total.textContent = site.count.toLocaleString();
    const control = document.createElement("td");
    control.append(
      buildSwitch(!paused, label.id, (on) => {
        row.classList.toggle("off", !on);
        void setSiteDisabled(site.hostname, !on).then(() => rerenderSiteList());
      })
    );
    row.append(name, barCell, total, control);
    tbody.append(row);
  }
  table.append(thead, tbody);
  const sitesHost = document.getElementById("s-table");
  if (sitesHost) {
    if (usage.topSites.length) {
      const note = document.createElement("p");
      note.className = "ins-note";
      note.textContent = tFallback("insSitesNote", "Switching Moat off for a site pauses it. It then shows under Exceptions › Paused.");
      sitesHost.replaceChildren(table, note);
    } else {
      sitesHost.replaceChildren(Object.assign(document.createElement("p"), { className: "ov-top-empty", textContent: tFallback("ovTopSitesEmpty", "Browse a few sites and they show up here.") }));
    }
  }
  const topSite = usage.topSites[0];
  setTakeaway(
    "s-take",
    topSite
      ? [{ bold: topSite.hostname.replace(/^www\./, "") }, ` ${tFallback("insSitesTake", `had the most blocks this week: ${topSite.count.toLocaleString()}.`, topSite.count.toLocaleString())}`]
      : []
  );

  // Security: pages stopped before they loaded.
  const stops = usage.pageStops;
  document.getElementById("sec-kpis")?.replaceChildren(
    buildKpi(document, tFallback("insKpiStopped", "Pages stopped"), stops.length, null, [], tFallback),
    buildKpi(document, tFallback("insKpiSecurityLists", "Dangerous-site lists on"), SECURITY_GROUPS.filter((g) => settings.filterGroups[g] ?? true).length, null, [], tFallback)
  );
  const list = document.getElementById("sec-list");
  if (list) {
    if (!stops.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "ov-top-empty", textContent: tFallback("ovTopStopsEmpty", "None this week.") }));
    } else {
      const t2 = document.createElement("table");
      t2.className = "ins-table";
      const body = document.createElement("tbody");
      for (const stop of stops) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        const wrap = document.createElement("div");
        wrap.className = "site gray";
        const name = document.createElement("span");
        name.textContent = stop.hostname;
        wrap.append(siteIcon(stop.hostname), name);
        td.append(wrap);
        const when = document.createElement("td");
        when.className = "muted";
        when.textContent = new Date(stop.time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
        tr.append(td, when);
        body.append(tr);
      }
      t2.append(body);
      list.replaceChildren(t2);
    }
  }
}

const SECURITY_GROUPS = ["phishing-urls", "scam", "malicious-urls", "badware"];

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
    importSettingsStatus.textContent = tFallback("optionsImportReadError", "Couldn't read that file. Choose a backup file saved by Moat.");
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

void render();

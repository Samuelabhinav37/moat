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
import { buildSiteIcon, faviconUrl } from "./siteIcon";
import { buildGlyphTile, stopGlyph, type GlyphName } from "./glyphs";
import { openPopMenu } from "./popMenu";
import { buildExceptionRow, exceptionSites, matchesFilter, sharedNames, type ExceptionFilter, type ExceptionHandlers, type ExceptionLabels, type ExceptionSite, type SiteState } from "./exceptionsList";
import { siteName } from "../shared/siteName";
import { initDashboard, pageFromHash, tabFromHash } from "./dashboard";
import { buildExplainer, helpSceneFor, initExplainerPanel } from "./explainerPanel";
import { buildBrandLogo, buildBrandTile, prependBrand, type BrandId } from "./brandIcons";
import { REPORT_ENDPOINT } from "../shared/reportEndpoint";
import { SITE_URLS } from "../shared/siteUrls";
import { optionalFlowsOn } from "../shared/networkFlows";
import { initSettingsSearch, revealSetting } from "./settingsSearch";
import { readCachedChoice, rememberTheme } from "../ui/theme";
import { openPauseMenu } from "./pauseMenu";
import { pauseEnd, pauseEndLabel, type PauseLength } from "../shared/pauseDuration";
import { initNavMode } from "./navMode";
import { TOPICS, initHelpPanel } from "./helpPanel";
import { initKaiGuide } from "./kaiGuide";
import { LEVELS, openCheckup, type Level } from "./checkup";
import { LIST_LABELS, SECTION_TITLES, groupLists } from "./filterListLabels";
import { buildHighlight, buildKpi, buildWeekChart, changePercent, type DayColumn } from "./overviewView";
import { buildDays, buildPurposes, buildReachRows, busiestDayPhrase, purposeLabel, purposeShares, type DayData } from "./insightsView";
import { groupLabel, groupSites, type SiteGroup } from "./siteGroups";
import { createSavedToast } from "./savedToast";
import { getLastBackupAt, recordBackupTaken } from "../background/backupStats";
import { validateImportedSettings } from "../background/settingsPortability";
import { importRisks, summarizeSettingsImport } from "../shared/settingsDiff";
import type {
  PauseSource,
  AddCustomDomainMessage,
  AddCustomDomainResponse,
  CheckForLiveUpdatesMessage,
  CompanyBreakdownResponse,
  CustomDomainListField,
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
  BlockKinds,
} from "../types";
import { STORAGE_KEY } from "../types";
import { joinCompanyBreakdown, type CompanyInfo } from "./trackerView";
import { siteOverrideEntries, type SiteOverrideEntry } from "./siteOverrides";
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

async function setSiteDisabled(hostname: string, disabled: boolean, until?: number, from?: PauseSource): Promise<void> {
  const message: ToggleSiteMessage = { type: "toggle-site", hostname, disabled, ...(until !== undefined ? { until } : {}), ...(from ? { from } : {}) };
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
  return response?.ok === true;
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
// Problem reports only appear as a data flow in builds that can send them.
for (const id of ["flow-reports", "flow-checkin"]) (document.getElementById(id) as HTMLElement | null)?.toggleAttribute("hidden", !REPORT_ENDPOINT);
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
  docsUrl: SITE_URLS.faq,
  testPageUrl: "https://d3ward.github.io/toolz/adblock.html",
});
// Kai in the bottom-right corner: plain questions; each answer opens the
// right screen and outlines the control (kaiGuide.ts). It also reacts to
// what happens here: protection off and on, a paused site, a milestone.
const kaiGuide = initKaiGuide(document, {
  t: tFallback,
  currentScreen: () => pageFromHash(window.location.hash),
  isOff: () => document.getElementById("ov-status")?.dataset.state === "off",
  turnOn: () => void setSettings({ enabled: true }).then(() => render()),
  openHelp: () => helpPanel.open(),
  questions: [
    { id: "pause", ask: ["kaiQPause", "How do I pause Moat on a site?"], answer: ["kaiAPause2", "On the site, click the Moat icon next to the address bar and turn off its switch. You can also press Add a site here."], hash: "#exceptions", target: "#ex-add-open" },
    { id: "level", ask: ["kaiQLevel", "Where do I change how much Moat blocks?"], answer: ["kaiALevel", "Under Protection, pick a level. Balanced suits most people."], hash: "#blocking", target: "#level-cards" },
    { id: "blocked", ask: ["kaiQBlocked", "Where do I see what Moat blocked?"], answer: ["kaiABlocked", "Overview shows your week. Trackers shows who tried to follow you, and Sites shows where."], hash: "#overview", target: ".ov-week" },
    { id: "hide", ask: ["kaiQHide", "How do I hide something on a page?"], answer: ["kaiAHide2", "On the page, click the Moat icon and choose Hide something. Sites where you hid something are listed here."], hash: "#exceptions", target: "#pick-element-button" },
    { id: "block", ask: ["kaiQBlock", "How do I always block a site?"], answer: ["kaiABlock2", "Press Add a site, type the site and pick Always block."], hash: "#exceptions", target: "#ex-add-open" },
    { id: "backup", ask: ["kaiQBackup", "How do I keep my settings on another computer?"], answer: ["kaiABackup", "Under Backup and sync, save a backup file or turn on sync."], hash: "#backup", target: "#a-backup" },
    { id: "broken", ask: ["kaiQBroken", "A site isn't working"], answer: ["kaiABroken", "Let's fix it step by step."], run: () => helpPanel.openTopic("load") },
    { id: "working", ask: ["kaiQWorking", "Is Moat working?"], answer: ["kaiAWorking", "Here's how to check."], run: () => helpPanel.openTopic("verify") },
    { id: "data", ask: ["kaiQData", "Does Moat collect my data?"], answer: ["kaiAData", "No. Blocking runs on your device, with no account and no analytics. The daily list updates carry nothing about you."] },
  ],
  firstOn: {
    overview: ["blocked", "working"],
    protection: ["level", "broken"],
    exceptions: ["pause", "hide", "block"],
    backup: ["backup"],
    trackers: ["blocked"],
    sites: ["pause", "broken"],
    security: ["broken"],
    about: ["working", "data"],
  },
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
  if (area === "local" && STORAGE_KEY in changes) savedToast.settingsChanged(tFallback("toastSaved", "Saved. Applies to pages you open or reload."));
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
    titleKey: ["optionsCookiesToggleLabel", "Block all cross-site cookies"],
    descKey: [
      "optionsCookiesToggleHint",
      "Applies to your whole browser, even sites you paused, and can break sign-ins.",
    ],
  },
  {
    id: "webrtc",
    settingKey: "webrtcLeakProtection",
    group: "privacy",
    titleKey: ["optionsWebrtcToggleLabel", "Keep your IP address private"],
    descKey: [
      "optionsWebrtcToggleHint",
      "Keeps pages from finding your real IP address, which shows roughly where you are. Works even when you use a VPN.",
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
      "Now and then this trips up an \"I'm not a robot\" check or a bank's device check. If a site acts up, turn this off first.",
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
      "Turns on Firefox's own, stronger device protection. It covers more than Moat can, such as window size, fonts and time zone.",
    ],
    cautionKey: [
      "optionsFirefoxRFPCaution",
      "This changes how Firefox itself behaves, not just what pages see, so it can break more than Moat's device protection above. Try it for a few days before you rely on it.",
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
      "Can break signing in with Google or Facebook on other sites. If a sign-in stops working, turn this off first.",
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
      "Folds away low-quality sites built to rank in search results.",
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
const PRIVACY_GROUPS: { key: string; fallback: string; ids: string[]; footer?: [string, string] }[] = [
  { key: "privacyGroupTracking", fallback: "Tracking", ids: ["cookies", "cname", "firefoxFirstPartyIsolate"] },
  { key: "privacyGroupDevice", fallback: "Your device", ids: ["fingerprint", "firefoxResistFingerprinting", "webrtc"] },
  { key: "privacyGroupPermissions", fallback: "Permissions and passwords", ids: ["permissionGuard", "leakedPassword"], footer: ["privacyFootPassword", "Only a short scrambled piece of a password is checked, never the password."] },
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
 * (cautions, evidence, chips). A `quiet` row shows only its title, the way
 * iOS Settings does: the description is the title's tooltip and is still
 * read out, and the (i) button's picture explains the rest. */
function buildSettingRow(options: {
  icon: string;
  brands?: BrandId[];
  titleId: string;
  title: string;
  desc?: string;
  on: boolean;
  extra?: HTMLElement[];
  control?: HTMLElement;
  quiet?: boolean;
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
    desc.className = options.quiet ? "setting-desc sr-only" : "setting-desc";
    desc.textContent = options.desc;
    if (options.quiet) title.title = options.desc;
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
  "To find these on Chrome, Moat asks Cloudflare where a site's addresses really lead. It can miss the first one on each site. Firefox checks this itself, so nothing is asked."
);

const liveStatus = document.getElementById("live-status") as HTMLElement | null;

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

/** The search box and "Show all" on Sites' and Trackers' long lists. */
const longListLabels: LongListLabels = {
  search: tFallback("listSearch", "Search"),
  showAll: (count) => tFallback("listShowAll", `Show all ${count}`, String(count)),
  showFewer: tFallback("listShowFewer", "Show fewer"),
  noMatches: tFallback("listNoMatches", "No matches."),
};

// Chrome only: the manifest asks for "favicon" there (see siteIcon.ts).
const faviconsSupported = (browser.runtime.getManifest().permissions ?? []).includes("favicon");
const siteIcon = (hostname: string) =>
  buildSiteIcon(document, hostname, faviconUrl(hostname, (path) => browser.runtime.getURL(path), faviconsSupported));

// ---------- Changed for one site ----------

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
    else if (chromeSupported && checked) {
      // Who it asks, while it's on (About lists it too).
      const hint = buildLine("setting-desc", cnameChromeDohHint);
      prependBrand(hint, "cloudflare");
      extra.push(hint);
    }
  }
  // A caution matters once the setting is on: that's when it can trip a site up.
  if (def.cautionKey && checked) extra.push(buildLine("setting-caution", tFallback(...def.cautionKey)));
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
    quiet: true,
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
  // The chips are switches: say so, and say what they switch.
  const chipsLabel = document.createElement("span");
  chipsLabel.className = "chips-label";
  chipsLabel.id = "permission-chips-label";
  chipsLabel.textContent = tFallback("optionsChipsLabel", "Block requests for:");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-labelledby", chipsLabel.id);
  chips.append(chipsLabel);
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
      // Show the change at once; saving and redrawing follow.
      const next = chip.getAttribute("aria-pressed") !== "true";
      chip.classList.toggle("on", next);
      chip.setAttribute("aria-pressed", String(next));
      void setSettings({ [kind.key]: next } as Partial<Pick<Settings, SettingsPatchField>>).then(() => render());
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
    quiet: true,
  });
}

/** A labelled group of setting rows in its own inset box (Protection page),
 * with an optional one-line footer under it, as in iOS Settings. */
function buildInsetGroup(title: string, rows: HTMLElement[], note?: string, footer?: string): HTMLElement {
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
  if (footer) group.append(Object.assign(document.createElement("p"), { className: "pgroup-foot", textContent: footer }));
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
    const footer = group.footer ? tFallback(...group.footer) : undefined;
    privacyRows.push(buildInsetGroup(tFallback(group.key, group.fallback), rows, undefined, footer));
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
  if (status.stale) {
    text += tFallback("optionsLiveStatusStale", " The newest update is more than two weeks old, so updates may have stopped.");
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
  kaiGuide.protection(state === "off");
  const title = document.getElementById("ov-status-title") as HTMLElement;
  const msg = document.getElementById("ov-status-msg") as HTMLElement;
  msg.hidden = ovStatusAction.hidden = state === "on";
  const pausedEl = document.getElementById("ov-status-paused") as HTMLElement;
  pausedEl.hidden = true;
  if (state === "on") {
    title.textContent = tFallback("ovStatusProtecting", "Moat is protecting you");
    const paused = overviewSettings.disabledSites.length;
    pausedEl.hidden = paused === 0;
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

/** A failed update turns the banner into "Lists couldn't update"; when the
 * lists were last updated is on Security's Safety check. */
function renderOverviewListsAge(status: Awaited<ReturnType<typeof getLiveUpdateStatus>>): void {
  overviewLiveStatus = status;
  renderOverviewStatus();
}

/** The level on Overview is a pop-up button: pressing it lists the three
 * levels, each with one line on what it adds, and picking one applies it. */
const ovLevel = document.getElementById("ov-level") as HTMLButtonElement;
const LEVEL_MENU: Record<Level, [string, string]> = {
  lite: ["levelMenuLight", "Blocks ads. Fewest broken sites."],
  standard: ["levelMenuBalanced", "Also blocks trackers. Best for most people."],
  strict: ["levelMenuStrict", "Also hides cookie banners. Some sites may break."],
};
ovLevel.addEventListener("click", () => {
  if (ovLevel.getAttribute("aria-expanded") === "true") return;
  const settings = overviewSettings;
  if (!settings) return;
  const preset = detectPreset(settings);
  const current = (LEVELS as readonly string[]).includes(preset) ? (preset as Level) : preset === "custom" ? (presetDifference(settings).base as Level) : null;
  openPopMenu(
    document,
    ovLevel,
    tFallback("levelTitle", "Level"),
    LEVELS.map((level) => ({ value: level, label: levelLabel(level), desc: tFallback(...LEVEL_MENU[level]) })),
    current,
    (level) => {
      document.getElementById("ov-status-level")!.textContent = levelLabel(level);
      void applyLevel(level);
    }
  );
});

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
  // The three levels say exactly what their level cards say.
  lite: { key: "levelMenuLight", fallback: "Blocks ads. Fewest broken sites." },
  essential: { key: "presetHintEssential", fallback: "Ads, popups, and known-malicious sites." },
  standard: { key: "levelMenuBalanced", fallback: "Also blocks trackers. Best for most people." },
  strict: { key: "levelMenuStrict", fallback: "Also hides cookie banners. Some sites may break." },
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
    const url = browser.runtime.getURL("rules/rulesets.json");
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
const levelNoteReset = document.getElementById("level-note-reset") as HTMLButtonElement;

// Names for the parts of a level that a hand-picked mix can change.
const PRIVACY_NAMES: Record<string, [string, string]> = {
  blockThirdPartyCookies: ["optionsCookiesToggleLabel", "Block all cross-site cookies"],
  webrtcLeakProtection: ["optionsWebrtcToggleLabel", "Keep your IP address private"],
  fingerprintResistance: ["optionsFingerprintToggleLabel", "Stop sites recognizing your device"],
};

function levelName(level: string): string {
  return document.querySelector(`#level-cards .level[data-level="${level}"] .level-name`)?.textContent ?? level;
}

/** "Balanced, plus Block all cross-site cookies and without Trackers." */
function changesSentence(settings: Settings): { base: PresetName; text: string; count: number } {
  const diff = presetDifference(settings);
  const name = (key: string): string => {
    const list = LIST_LABELS[key];
    if (list) return tFallback(list.nameKey, list.name);
    const privacy = PRIVACY_NAMES[key];
    return privacy ? tFallback(privacy[0], privacy[1]) : key;
  };
  const base = levelName(diff.base);
  const added = diff.added.map(name).join(", ");
  const removed = diff.removed.map(name).join(", ");
  const text =
    added && removed
      ? tFallback("levelChangesBoth", `${base}, plus ${added}, without ${removed}.`, [base, added, removed])
      : added
        ? tFallback("levelChangesPlus", `${base}, plus ${added}.`, [base, added])
        : tFallback("levelChangesMinus", `${base}, without ${removed}.`, [base, removed]);
  return { base: diff.base, text, count: diff.added.length + diff.removed.length };
}

function renderLevels(preset: PresetName | "custom", locked: boolean, settings: Settings): void {
  // A changed level keeps its card selected, marked "Customized", so the
  // page never looks as if no level is chosen.
  // With Moat off, the level it comes back to stays selected.
  const off = preset === "off";
  const level = off ? detectPreset({ ...settings, enabled: true }) : preset;
  // Any mix that isn't one of the three cards (a hand-picked mix, or an
  // older level like Essential) reads as the nearest card, changed.
  const custom = level !== "off" && !(MAIN_LEVELS as readonly string[]).includes(level) ? changesSentence(settings) : null;
  const selected = custom ? custom.base : level;
  for (const card of levelCards) {
    card.setAttribute("aria-checked", String(card.dataset.level === selected));
    card.disabled = locked;
  }
  for (const badge of document.querySelectorAll("#level-cards .level-mix")) badge.remove();
  levelNote.hidden = !custom && !off;
  if (off) {
    levelNoteText.textContent = tFallback("levelOffNote", "Moat is off, so nothing is blocked.");
    levelNoteReset.textContent = tFallback("checkTurnOn", "Turn on");
    levelNoteReset.dataset.level = "";
    levelNoteReset.disabled = locked;
  } else if (custom) {
    levelNoteText.textContent = custom.text;
    levelNoteReset.textContent = tFallback("filtersLevelResetTo", `Reset to ${levelName(custom.base)}`, levelName(custom.base));
    levelNoteReset.dataset.level = custom.base;
    levelNoteReset.disabled = locked;
    document.querySelector(`#level-cards .level[data-level="${custom.base}"] .level-top`)?.append(Object.assign(document.createElement("span"), { className: "level-mix", textContent: tFallback("levelCustomized", "Customized") }));
  }
}

/** Applies a level. Coming from a customized level drops those changes, so
 * it says so and offers Undo. */
async function applyLevel(level: PresetName): Promise<void> {
  const before = lastSettings ?? (await getEffectiveSettings());
  const wasCustom = detectPreset(before) === "custom";
  const patch = presetPatch(level);
  await setSettings(patch);
  await render();
  if (wasCustom) {
    const undo = Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof Settings]])) as Partial<Settings>;
    savedToast.offerUndo(tFallback("levelResetDone", `Back to ${levelName(level)}. Your changes were removed.`, levelName(level)), tFallback("toastUndo", "Undo"), () => {
      void setSettings(undo).then(() => render());
    });
  }
}

for (const card of levelCards) {
  card.addEventListener("click", () => {
    // Select the card at once: applying a level turns whole rulesets on or
    // off in the browser, which takes a few hundred milliseconds.
    for (const other of levelCards) other.setAttribute("aria-checked", String(other === card));
    for (const badge of document.querySelectorAll("#level-cards .level-mix")) badge.remove();
    levelNote.hidden = true;
    void applyLevel(card.dataset.level as PresetName);
  });
}
levelNoteReset.addEventListener("click", () => {
  if (!levelNoteReset.dataset.level) void setSettings({ enabled: true }).then(() => render());
  else void applyLevel(levelNoteReset.dataset.level as PresetName);
});

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
  } else if (preset !== "off") {
    const mix = changesSentence(settings);
    levelLineText.textContent = mix.text;
    levelLineReset.dataset.level = mix.base;
    levelLineReset.textContent = tFallback("filtersLevelResetTo", `Reset to ${levelName(mix.base)}`, levelName(mix.base));
  } else if (preset === "off") {
    levelLineText.textContent = tFallback("levelOffNote", "Moat is off, so nothing is blocked.");
    levelLineReset.hidden = true;
    levelLineChange.hidden = true;
    return;
  }
  levelLineChange.hidden = !onCard;
  levelLineReset.hidden = onCard;
}

levelLineReset.addEventListener("click", () => void applyLevel((levelLineReset.dataset.level as PresetName | undefined) ?? "standard"));

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

// ---------- Exceptions: one list of sites (exceptionsList.ts) ----------

const exRows = document.getElementById("ex-rows") as HTMLElement;
const exEmpty = document.getElementById("ex-empty") as HTMLElement;
const exSearch = document.getElementById("ex-search") as HTMLInputElement;
const exFilterGroup = document.getElementById("ex-filter") as HTMLElement;
const exAddForm = document.getElementById("ex-add-form") as HTMLFormElement;
const exAddInput = document.getElementById("ex-add-input") as HTMLInputElement;
const exAddState = document.getElementById("ex-add-state") as HTMLSelectElement;
const exAddOpen = document.getElementById("ex-add-open") as HTMLButtonElement;
const exAddStatus = document.getElementById("ex-add-status") as HTMLElement;
const pickElementButton = document.getElementById("pick-element-button") as HTMLButtonElement;
const pickElementStatus = document.getElementById("pick-element-status") as HTMLElement;

/** Old links (#paused, #hidden, #rules) open the list filtered to match. */
const FILTER_FOR_TAB: Record<string, ExceptionFilter> = { paused: "paused", hidden: "hidden", rules: "all" };
let exFilter: ExceptionFilter = FILTER_FOR_TAB[tabFromHash(location.hash) ?? ""] ?? "all";

const exLabels: ExceptionLabels = {
  menuLabel: (name) => tFallback("exMenuLabel", `What Moat does on ${name}`, name),
  states: {
    protected: { label: tFallback("exStateProtected", "Protected"), desc: tFallback("exStateProtectedDesc", "Moat's usual blocking.") },
    paused: { label: tFallback("exStatePaused", "Paused"), desc: tFallback("exStatePausedDesc", "Ads and trackers load here.") },
    block: { label: tFallback("exStateBlock", "Always block"), desc: tFallback("exStateBlockDesc", "Nothing from this site loads.") },
    allow: { label: tFallback("exStateAllow", "Never block"), desc: tFallback("exStateAllowDesc", "Loads on every site you visit.") },
  },
  hidden: (n) => (n === 1 ? tFallback("exHiddenOne", "1 thing hidden") : tFallback("exHiddenMany", `${n} things hidden`, String(n))),
  grayed: (n) => (n === 1 ? tFallback("exGrayedOne", "1 thing grayed out") : tFallback("exGrayedMany", `${n} things grayed out`, String(n))),
  changed: (n) => (n === 1 ? tFallback("exChangedOne", "1 setting changed here") : tFallback("exChangedMany", `${n} settings changed here`, String(n))),
  showAgain: tFallback("exShowAgain", "Show again"),
  reset: tFallback("popupOverrideReset", "Reset"),
};

/** Leaves one state for another: off the old list, onto the new one. */
async function moveSite(hostname: string, from: SiteState, to: SiteState, pauseUntil?: number): Promise<void> {
  if (from === "paused" && to !== "paused") await setSiteDisabled(hostname, false);
  if (from === "block") await sendRemoveCustomDomain("customBlockedDomains", hostname);
  if (from === "allow") await sendRemoveCustomDomain("customAllowedDomains", hostname);
  if (to === "paused") await setSiteDisabled(hostname, true, pauseUntil, "exceptions");
  if (to === "block") await sendAddCustomDomain("customBlockedDomains", hostname);
  if (to === "allow") await sendAddCustomDomain("customAllowedDomains", hostname);
}

/** Changes what Moat does on a site, then offers Undo. Pausing asks for how
 * long first, with the same menu as everywhere else. */
function setSiteState(site: ExceptionSite, to: SiteState, anchor: HTMLElement): void {
  const name = siteName(site.hostname);
  const apply = (until?: number) =>
    void (async () => {
      const before = { state: site.state, until: lastSettings?.pausedUntil[site.hostname] };
      await moveSite(site.hostname, site.state, to, until);
      if (to === "paused") kaiGuide.moment({ name: "paused" });
      await render();
      savedToast.offerUndo(tFallback("exStateDone", `${name}: ${exLabels.states[to].label}`, [name, exLabels.states[to].label]), tFallback("toastUndo", "Undo"), () => {
        void moveSite(site.hostname, to, before.state, before.until).then(() => render());
      });
    })();
  if (to !== "paused") return apply();
  openPauseMenu(document, anchor, pauseMenuLabels(name), (choice) => {
    if (choice !== null) apply(pauseEnd(choice, Date.now()));
  });
}

/** Brings back everything hidden or grayed out on a site, with Undo. */
function showSiteAgain(site: ExceptionSite): void {
  const settings = lastSettings;
  if (!settings) return;
  const hidden = [...(settings.customCosmeticRules[site.hostname] ?? [])];
  const grayed = [...(settings.customGrayscaleRules[site.hostname] ?? [])];
  void (async () => {
    for (const selector of hidden) await removeCustomCosmeticRule(site.hostname, selector);
    for (const selector of grayed) await removeGrayscaleRule(site.hostname, selector);
    await render();
    const name = siteName(site.hostname);
    savedToast.offerUndo(tFallback("exShownAgain", `Showing everything on ${name} again`, name), tFallback("toastUndo", "Undo"), () => {
      void (async () => {
        for (const selector of hidden) await saveCosmeticRule(site.hostname, selector);
        for (const selector of grayed) await saveGrayscaleRule(site.hostname, selector);
        await render();
      })();
    });
  })();
}

/** Puts a site's settings changed from Moat's icon back to the usual ones. */
function resetSite(site: ExceptionSite): void {
  const entry = lastSettings ? siteOverrideEntries(lastSettings.perSiteOverrides).find((e) => e.hostname === site.hostname) : undefined;
  if (!entry) return;
  void (async () => {
    await setSiteOverrides(entry, false);
    await render();
    const name = siteName(site.hostname);
    savedToast.offerUndo(tFallback("toastReset", `Reset ${name}`, name), tFallback("toastUndo", "Undo"), () => {
      void setSiteOverrides(entry, true).then(() => render());
    });
  })();
}

function renderExceptions(settings: Settings): void {
  const all = exceptionSites(settings, (h) => pausedNote(settings, h));
  const count = document.getElementById("nav-count-exceptions");
  if (count) {
    count.textContent = all.length ? all.length.toLocaleString() : "";
    count.hidden = all.length === 0;
  }
  const query = exSearch.value.trim().toLowerCase();
  const shown = all.filter((site) => matchesFilter(site, exFilter) && (!query || `${siteName(site.hostname)} ${site.hostname}`.toLowerCase().includes(query)));
  const shared = sharedNames(all);
  const handlers: ExceptionHandlers = { setState: setSiteState, showAgain: showSiteAgain, reset: resetSite };
  exRows.replaceChildren(...shown.map((site) => buildExceptionRow(document, site, exLabels, handlers, siteIcon, shared.has(siteName(site.hostname)))));
  for (const button of exFilterGroup.querySelectorAll<HTMLButtonElement>("[data-filter]")) button.setAttribute("aria-pressed", String(button.dataset.filter === exFilter));
  exEmpty.hidden = shown.length > 0;
  const title = document.getElementById("ex-empty-title")!;
  const hint = document.getElementById("ex-empty-hint")!;
  if (!all.length) {
    title.textContent = tFallback("exEmptyTitle", "No exceptions yet");
    hint.textContent = tFallback("exEmptyHint", "Pause a site, hide part of a page or block a site, and it shows here.");
  } else {
    title.textContent = tFallback("listNoMatches", "No matches.");
    hint.textContent = "";
  }
}

exSearch.addEventListener("input", () => {
  if (lastSettings) renderExceptions(lastSettings);
});
for (const button of exFilterGroup.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
  button.addEventListener("click", () => {
    exFilter = button.dataset.filter as ExceptionFilter;
    if (lastSettings) renderExceptions(lastSettings);
  });
}
window.addEventListener("hashchange", () => {
  const tab = tabFromHash(location.hash);
  if (!tab || !FILTER_FOR_TAB[tab]) return;
  exFilter = FILTER_FOR_TAB[tab]!;
  if (lastSettings) renderExceptions(lastSettings);
});

function closeAddForm(): void {
  exAddForm.hidden = true;
  exAddOpen.hidden = false;
  exAddOpen.setAttribute("aria-expanded", "false");
  exAddStatus.hidden = true;
}
exAddOpen.addEventListener("click", () => {
  exAddForm.hidden = false;
  exAddOpen.hidden = true;
  exAddOpen.setAttribute("aria-expanded", "true");
  exAddInput.focus();
});
document.getElementById("ex-add-cancel")!.addEventListener("click", () => {
  closeAddForm();
  exAddOpen.focus();
});
exAddForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const hostname = normalizeHostname(exAddInput.value);
  if (!hostname) {
    exAddStatus.hidden = false;
    exAddStatus.textContent = tFallback("optionsAddDomainInvalid", "Enter a site address like example.com.");
    return;
  }
  const choice = exAddState.value;
  void (async () => {
    if (choice === "block" || choice === "allow") {
      const ok = await sendAddCustomDomain(choice === "block" ? "customBlockedDomains" : "customAllowedDomains", hostname);
      if (!ok) {
        exAddStatus.hidden = false;
        exAddStatus.textContent = tFallback("optionsAddDomainFailed", "Couldn't add that domain. Try again.");
        return;
      }
    } else {
      await setSiteDisabled(hostname, true, pauseEnd(choice as PauseLength, Date.now()), "exceptions");
      kaiGuide.moment({ name: "paused" });
    }
    exAddInput.value = "";
    closeAddForm();
    await render();
  })();
});

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
  await render();
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

const themeRadios = document.querySelectorAll<HTMLInputElement>('.theme-choice input[name="theme"]');

/** Shows the saved choice, and refreshes this browser's fast-start copy when
 * the setting changed elsewhere (sync, a restored backup, another device). */
function renderTheme(choice: Settings["theme"]): void {
  for (const radio of themeRadios) radio.checked = radio.value === choice;
  if (readCachedChoice() !== choice) rememberTheme(choice);
}

for (const radio of themeRadios) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    const choice = radio.value as Settings["theme"];
    rememberTheme(choice);
    void setSettings({ theme: choice });
  });
}

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

/** "Until 3:40 PM" for a timed pause; nothing for one that lasts. */
function pausedUntilNote(until: number | undefined): string | null {
  if (until === undefined) return null;
  const when = pauseEndLabel(until, Date.now(), tFallback("pauseTomorrow", "tomorrow"));
  return tFallback("pauseUntil", `Until ${when}`, when);
}

/** "From the popup, 3 days ago", then "Until 3:40 PM" for a timed pause.
 * Pauses from before Moat recorded this show only the end time. */
function pausedNote(settings: Settings, hostname: string): string | null {
  const info = settings.pauseInfo[hostname];
  const parts: string[] = [];
  if (info) {
    const when = timeAgo(info.at, Date.now());
    const where: Record<PauseSource, string> = {
      popup: tFallback("pausedFromPopup", `From Moat's icon, ${when}`, when),
      sites: tFallback("pausedFromSites", `From Sites, ${when}`, when),
      exceptions: tFallback("pausedFromExceptions", `Added here, ${when}`, when),
      report: tFallback("pausedFromReport", `While reporting a problem, ${when}`, when),
    };
    parts.push(info.from ? where[info.from] : tFallback("pausedAt", `Paused ${when}`, when));
  }
  const until = pausedUntilNote(settings.pausedUntil[hostname]);
  if (until) parts.push(until);
  return parts.length ? parts.join(" · ") : null;
}

/** "just now", "5 minutes ago", "yesterday", "3 days ago", in the page's language. */
function timeAgo(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000);
  if (minutes > -1) return tFallback("timeJustNow", "just now");
  const rel = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (minutes > -60) return rel.format(minutes, "minute");
  if (minutes > -1440) return rel.format(Math.round(minutes / 60), "hour");
  return rel.format(Math.round(minutes / 1440), "day");
}

function pauseMenuLabels(hostname: string) {
  return {
    title: tFallback("pauseMenuTitle", `Pause Moat on ${hostname}`, hostname),
    hour: tFallback("pauseForHour", "For 1 hour"),
    day: tFallback("pauseForDay", "For 1 day"),
    always: tFallback("pauseUntilResumed", "Until I turn it back on"),
  };
}

async function render(): Promise<void> {
  const [settings, policy] = await Promise.all([getEffectiveSettings(), getManagedPolicy()]);

  await renderProtectionTab(settings);
  if (lastUsage) {
    renderOverview(settings, lastUsage);
    void renderInsights(settings, lastUsage);
  }

  renderSyncStatus(settings.syncEnabled, await getSyncStatus());
  renderTheme(settings.theme);
  renderLiveStatus(await getLiveUpdateStatus(), await getYoutubeQuickFixesStatus());

  renderExceptions(settings);

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

  await renderBackupTab(settings);
  await renderAboutTab(policy, settings);
  explainerPanel.refresh();
}

// ---------- Backup tab (DR-15) ----------

const exportSettingsButton = document.getElementById("export-settings-button") as HTMLButtonElement;
const importSettingsButton = document.getElementById("import-settings-button") as HTMLButtonElement;
const importSettingsInput = document.getElementById("import-settings-input") as HTMLInputElement;
const importSettingsStatus = document.getElementById("import-settings-status") as HTMLElement;
const importSettingsConfirm = document.getElementById("import-settings-confirm") as HTMLElement;
const importSettingsSummary = document.getElementById("import-settings-summary") as HTMLUListElement;
const importSettingsRisks = document.getElementById("import-settings-risks") as HTMLElement;
const importSettingsRiskList = document.getElementById("import-settings-risk-list") as HTMLUListElement;
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

  const undo = await getImportUndo();
  const undoRow = document.getElementById("import-undo");
  if (undoRow) {
    undoRow.hidden = !undo;
    if (undo) {
      const when = new Date(undo.time).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      document.getElementById("import-undo-text")!.textContent = tFallback("backupRestoredOn", `Restored from a file on ${when}.`, when);
    }
  }
}

document.getElementById("import-undo-button")?.addEventListener("click", () => void undoImport());

// ---------- Trackers tab ----------

const trackerRows = document.getElementById("tracker-rows") as HTMLElement;
const trackersSubhead = document.getElementById("trackers-subhead") as HTMLElement;
const trackersEmpty = document.getElementById("trackers-empty") as HTMLElement;
const trackersUnsupported = document.getElementById("trackers-unsupported") as HTMLElement;
const trackersRefresh = document.getElementById("trackers-refresh") as HTMLAnchorElement;

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

/** Kai is proud once when this week's total passes 1,000, 10,000 or
 * 100,000, only while Overview is on screen. Remembered per week. */
const KAI_MILESTONES = [1000, 10000, 100000];
function celebrateWeek(week: number): void {
  if (pageFromHash(window.location.hash) !== "overview") return;
  const reached = KAI_MILESTONES.filter((m) => week >= m).pop();
  if (!reached) return;
  const weekNo = Math.floor(Date.now() / (7 * 86400000));
  let seen = { w: -1, m: 0 };
  try { seen = { ...seen, ...JSON.parse(localStorage.getItem("moat-kai-milestone") ?? "{}") }; } catch { /* first time */ }
  if (seen.w === weekNo && seen.m >= reached) return;
  try { localStorage.setItem("moat-kai-milestone", JSON.stringify({ w: weekNo, m: reached })); } catch { /* still fine */ }
  kaiGuide.moment({ name: "milestone", count: reached });
}

/** The week at a glance, from the same local counts the Trackers list
 * reads: usage.sparkline is 7 daily totals, oldest first, ending today. */
let overviewPeriod: "this" | "last" = "this";

function renderOverview(settings: Settings, usage: UsageSummaryResponse): void {
  // Last week can only be shown once there is one (14 days are kept).
  const periodGroup = document.getElementById("ov-period") as HTMLElement;
  periodGroup.hidden = !usage.previousWeek;
  if (!usage.previousWeek) overviewPeriod = "this";
  const last = overviewPeriod === "last" && usage.previousWeek ? usage.previousWeek : null;
  for (const b of periodGroup.querySelectorAll<HTMLButtonElement>("[data-period]")) b.setAttribute("aria-pressed", String(b.dataset.period === overviewPeriod));
  document.getElementById("ov-week-title")!.textContent = last
    ? tFallback("ovWeekTitleLast", "Blocked last week")
    : tFallback("ovWeekTitle", "Blocked this week");
  const days = last ? last.daily : usage.sparkline.slice(-7);
  const dailyKinds = last ? last.dailyKinds : usage.dailyKinds;
  const week = days.reduce((sum, n) => sum + n, 0);
  document.getElementById("ov-week-total")!.textContent = week.toLocaleString();
  if (!last) celebrateWeek(week);
  document.getElementById("ov-week-empty")!.hidden = week > 0;
  (document.querySelector(".ov-hint") as HTMLElement).hidden = week === 0;
  const preset = detectPreset(settings);
  document.getElementById("ov-status-level")!.textContent =
    preset === "custom" ? tFallback("ovLevelCustomized", `${levelLabel(presetDifference(settings).base)}, customized`, levelLabel(presetDifference(settings).base)) : levelLabel(preset);
  overviewSettings = settings;
  renderOverviewStatus();

  // One comparison, the way Screen Time and Health say it: "↑ 85% more
  // than the week before". The week itself is named once, by the picker
  // above. Neutral either way: more blocked can just mean more browsing.
  // Nothing older than last week is kept.
  const headline = document.getElementById("ov-headline")!;
  headline.replaceChildren();
  const change = last ? null : changePercent(week, usage.previousWeek?.total);
  if (change !== null && change !== 0 && week > 0) {
    const up = change > 0;
    headline.append(
      Object.assign(document.createElement("span"), { className: "ov-arrow", textContent: up ? "↑" : "↓" }),
      document.createTextNode(
        up
          ? tFallback("ovMoreThanBefore", `${change}% more than the week before`, String(change))
          : tFallback("ovFewerThanBefore", `${Math.abs(change)}% fewer than the week before`, String(Math.abs(change)))
      )
    );
  } else if (!last && week > 0 && !usage.previousWeek) {
    headline.textContent = tFallback("ovAcrossSites", `across ${usage.weekSiteCount} sites`, String(usage.weekSiteCount));
  }
  headline.hidden = !headline.textContent;

  const todayLabel = tFallback("ovToday", "Today");
  const columns: DayColumn[] = days.map((total, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (days.length - 1 - i) - (last ? 7 : 0));
    const kinds = dailyKinds[i] ?? { ads: 0, trackers: 0, popups: 0 };
    const sorted = kinds.ads + kinds.trackers + kinds.popups;
    const today = !last && i === days.length - 1;
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

  renderSecurityDot(usage);
  void renderOverviewTops(usage);
}

const SECURITY_SEEN_KEY = "moat-security-seen";

/** A red dot on Security when a page was stopped since it was last opened.
 * The time it was last opened is a per-device nicety, so localStorage. */
function renderSecurityDot(usage: UsageSummaryResponse): void {
  const dot = document.getElementById("nav-dot-security");
  if (!dot) return;
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(SECURITY_SEEN_KEY)) || 0;
  } catch {
    // Storage blocked: no dot.
    seen = Infinity;
  }
  const onSecurity = pageFromHash(location.hash) === "security";
  dot.hidden = onSecurity || !usage.pageStops.some((stop) => stop.time > seen);
}

function markSecuritySeen(): void {
  try {
    localStorage.setItem(SECURITY_SEEN_KEY, String(Date.now()));
  } catch {
    // Storage blocked: nothing to remember.
  }
  const dot = document.getElementById("nav-dot-security");
  if (dot) dot.hidden = true;
}

window.addEventListener("hashchange", () => {
  if (pageFromHash(location.hash) === "security") markSecuritySeen();
});
if (pageFromHash(location.hash) === "security") markSecuritySeen();

for (const button of document.querySelectorAll<HTMLButtonElement>("#ov-period [data-period]")) {
  button.addEventListener("click", () => {
    overviewPeriod = button.dataset.period === "last" ? "last" : "this";
    if (lastSettings && lastUsage) renderOverview(lastSettings, lastUsage);
  });
}

/** Why a card is empty, plus the one thing to do about it: check Moat is
 * working (the Help panel's step-through). */
function emptyWithCheck(text: string): HTMLElement {
  const block = document.createElement("div");
  block.className = "ov-empty-block";
  const p = Object.assign(document.createElement("p"), { className: "ov-top-empty", textContent: text });
  const button = Object.assign(document.createElement("button"), { type: "button", className: "ab-btn check-moat", textContent: tFallback("ovCheckMoat", "Check Moat is working") });
  block.append(p, button);
  return block;
}

document.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest(".check-moat")) helpPanel.openTopic("verify");
});

/** A tracker company's mark: its logo where Moat carries one, else its own
 * site's icon from the browser's cache, else its first letter. */
const COMPANY_BRANDS: Record<string, BrandId> = { Google: "google", Meta: "meta", Facebook: "meta", TikTok: "tiktok", ByteDance: "tiktok", X: "x", Twitter: "x" };
function companyIcon(company: string, info: Record<string, CompanyInfo> | null): HTMLElement {
  const brand = COMPANY_BRANDS[company];
  if (brand) {
    const tile = Object.assign(document.createElement("span"), { className: "site-icon has-img" });
    tile.setAttribute("aria-hidden", "true");
    tile.append(buildBrandLogo(document, brand, 16));
    return tile;
  }
  const host = info ? companyHost(info, company) : "";
  return host ? siteIcon(host) : buildSiteIcon(document, company, null);
}

/** A stopped page in a few words: what kind of page it was. */
function stopKindName(stop: UsageSummaryResponse["pageStops"][number]): string {
  switch (stopGlyph(stop.list, stop.kind)) {
    case "phishing":
      return tFallback("stopKindPhishing", "Fake sign-in page");
    case "scam":
      return tFallback("stopKindScam", "Fake shop");
    case "malware":
      return tFallback("stopKindMalware", "Malware");
    case "blocked":
      return stop.kind === "ads" ? tFallback("stopKindAds", "Ad page") : tFallback("stopKindCustom", "On a block list");
    default:
      return tFallback("stopKindDanger", "Dangerous site");
  }
}

/** Highlights: the top three trackers, sites and stopped pages, each card
 * with one short headline (Health's Highlights). */
async function renderOverviewTops(usage: UsageSummaryResponse): Promise<void> {
  const info = await loadCompanyInfo();
  const companies = [...usage.companiesThisWeek].sort((a, b) => b.count - a.count || b.hostnameCount - a.hostnameCount);
  const sites = groupSites(usage.topSites);
  const danger = usage.pageStops.filter((s) => s.kind === "danger" || !s.kind || s.kind === "unknown");
  const stops = [...danger, ...usage.pageStops.filter((s) => !danger.includes(s))];
  const tile = (glyph: GlyphName, danger = false) => buildGlyphTile(document, glyph, danger ? "glyph-tile tile-danger" : "glyph-tile");
  const top = companies[0];
  const site = sites[0];
  document.getElementById("ov-tops")!.replaceChildren(
    buildHighlight(
      document,
      tile("target"),
      tFallback("navTrackers", "Trackers"),
      top ? tFallback("hlTrackersTop", `${top.company} tracked you the most.`, top.company) : tFallback("ovTopTrackersEmpty", "No tracker companies this week yet."),
      companies.slice(0, 3).map((c) => ({ icon: companyIcon(c.company, info), name: c.company, value: c.count.toLocaleString() })),
      { href: "#trackers", label: tFallback("hlAllTrackers", "All trackers") }
    ),
    buildHighlight(
      document,
      tile("globe"),
      tFallback("navInsightSites", "Sites"),
      site ? tFallback("hlSitesTop", `${siteName(site.site)} had the most blocked.`, siteName(site.site)) : tFallback("ovTopSitesEmpty", "Browse a few sites and they show up here."),
      sites.slice(0, 3).map((g) => ({ icon: siteIcon(g.members[0]!.hostname), name: siteName(g.site), value: g.count.toLocaleString(), title: groupLabel(g) })),
      { href: "#sites", label: tFallback("hlAllSites", "All sites") }
    ),
    buildHighlight(
      document,
      tile("shield", true),
      tFallback("navSecurity", "Security"),
      danger.length === 1
        ? tFallback("hlStopsOne", "1 dangerous page stopped.")
        : danger.length
          ? tFallback("hlStopsMany", `${danger.length} dangerous pages stopped.`, String(danger.length))
          : tFallback("hlStopsNone", "No dangerous pages this week."),
      stops.slice(0, 3).map((stop) => ({ icon: stopIcon(stop), name: stopKindName(stop), value: relativeTime(stop.time), title: stop.hostname })),
      { href: "#security", label: tFallback("hlSecurityDetails", "Details") }
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

/** A company's own site, once the company list has loaded. */
function companyHostCache(company: string): string {
  return companyInfoCache ? companyHost(companyInfoCache, company) : "";
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
    buildKpi(
      document,
      tFallback("insKpiCompanies", "Companies"),
      companies.length,
      null,
      usage.companiesTrend.slice(0, 6),
      tFallback,
      tFallback("insKpiCompaniesNote", `on ${usage.trackerSiteCount} of the ${usage.weekSiteCount} sites you visited`, [String(usage.trackerSiteCount), String(usage.weekSiteCount)])
    )
  );
  const top = companies[0];
  setTakeaway(
    "t-who-take",
    top
      ? [{ bold: top.company }, ` ${tFallback("insWhoTake", `was on ${Math.round((top.hostnameCount / sitesThisWeek) * 100)}% of the sites you visited. Pick a company to see where.`, String(Math.round((top.hostnameCount / sitesThisWeek) * 100)))}`]
      : [tFallback("ovTopTrackersEmpty", "No tracker companies this week yet.")]
  );
  // Rows go straight into #t-who so the long-list search and "Show all"
  // attach once (inside the card), not on every render.
  const whoList = document.getElementById("t-who");
  const reach = buildReachRows(
    document,
    companies.map((c) => {
      const host = companyHost(info, c.company);
      return {
        company: c.company,
        icon: host ? siteIcon(host) : buildSiteIcon(document, c.company, null),
        sites: c.hostnameCount,
        ofSites: sitesThisWeek,
        blocks: c.count,
        description: info[c.company]?.description ?? "",
        seenOn: (usage.companySites[c.company] ?? []).map((hostname) => ({ hostname, icon: siteIcon(hostname) })),
        url: info[c.company]?.url ?? null,
      };
    }),
    tFallback,
    openSiteOnSites
  );
  if (whoList) {
    whoList.classList.add("reach");
    whoList.replaceChildren(...reach.children);
    applyLongList(whoList, longListLabels);
  }
  const shares = purposeShares(usage.purposes);
  setTakeaway(
    "t-what-take",
    shares[0]
      ? [{ bold: `${Math.round(shares[0].share * 100)}%` }, ` ${tFallback("insWhatTake", `were for ${purposeLabel(shares[0].category, tFallback).name.toLowerCase()}.`, purposeLabel(shares[0].category, tFallback).name.toLowerCase())}`]
      : [tFallback("insWhatEmpty", "Fills in as Moat blocks trackers.")]
  );
  document.getElementById("t-what")?.replaceChildren(...(shares.length ? [buildPurposes(document, usage.purposes, tFallback)] : []));
  const days: DayData[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const index = 6 - i;
    days.push({
      label: i === 0 ? tFallback("ovToday", "Today") : d.toLocaleDateString(undefined, { weekday: "short" }),
      name: i === 0 ? tFallback("ovToday", "Today") : d.toLocaleDateString(undefined, { weekday: "long" }),
      total: usage.sparkline[index] ?? 0,
      hours: usage.hours[index] ?? [],
      topSites: (usage.dailyTopSites?.[index] ?? []).map((s) => ({ ...s, icon: siteIcon(s.hostname) })),
    });
  }
  setTakeaway("t-when-take", [busiestDayPhrase(days, tFallback)]);
  document.getElementById("t-when")?.replaceChildren(buildDays(document, days, tFallback, openSiteOnSites));

  renderSitesPage(settings, usage);
  await renderSecurityPage(settings, usage);
}

// ---------- Sites ----------

/** One row per site (docs.google.com and mail.google.com under google.com),
 * most blocks first. A row opens to what was blocked there, the companies
 * seen there and, for a site with several addresses, each address. */
function renderSitesPage(settings: Settings, usage: UsageSummaryResponse): void {
  const host = document.getElementById("s-table");
  if (!host) return;
  const groups = groupSites(usage.topSites);
  const top = groups[0];
  setTakeaway("s-take", top ? [{ bold: siteName(top.site) },` ${tFallback("insSitesTake", `had the most blocks this week: ${top.count.toLocaleString()}.`, top.count.toLocaleString())}`] : []);
  if (!groups.length) {
    host.replaceChildren(emptyWithCheck(tFallback("insSitesEmpty", "No site has had anything blocked this week. Open a site you use often, then come back.")));
    return;
  }
  let rows = document.getElementById("s-rows");
  if (!rows) {
    rows = Object.assign(document.createElement("div"), { id: "s-rows", className: "site-rows" });
    const box = Object.assign(document.createElement("div"), { className: "site-box" });
    box.append(rows);
    const note = Object.assign(document.createElement("p"), { className: "ins-note", textContent: tFallback("insSitesNote", "Switching Moat off for a site pauses it. It then shows under Exceptions › Paused.") });
    host.replaceChildren(box, note);
  }
  rows.replaceChildren(...groups.map((group) => buildSiteRow(settings, group)));
  applyLongList(rows, longListLabels);
}

type TopSite = UsageSummaryResponse["topSites"][number];

function addKinds(members: readonly TopSite[]): BlockKinds | null {
  if (members.every((m) => !m.kinds)) return null;
  return members.reduce((sum, m) => ({ ads: sum.ads + (m.kinds?.ads ?? 0), trackers: sum.trackers + (m.kinds?.trackers ?? 0), popups: sum.popups + (m.kinds?.popups ?? 0) }), { ads: 0, trackers: 0, popups: 0 });
}

/** "141 ads · 142 trackers · 6 pop-ups", leaving out kinds with none. */
function kindsLine(kinds: BlockKinds | null): string {
  if (!kinds) return "";
  const parts: string[] = [];
  if (kinds.ads) parts.push(tFallback("siteKindAds", `${kinds.ads.toLocaleString()} ads`, kinds.ads.toLocaleString()));
  if (kinds.trackers) parts.push(tFallback("siteKindTrackers", `${kinds.trackers.toLocaleString()} trackers`, kinds.trackers.toLocaleString()));
  if (kinds.popups) parts.push(tFallback("siteKindPopups", `${kinds.popups.toLocaleString()} pop-ups`, kinds.popups.toLocaleString()));
  return parts.join(" · ");
}

/** Moat's switch for a set of addresses: on unless every one is paused.
 * Turning it off asks for how long, as everywhere else. */
function siteSwitch(settings: Settings, hostnames: string[], labelId: string, name: string, row: HTMLElement): HTMLElement {
  const paused = hostnames.every((h) => settings.disabledSites.includes(h));
  row.classList.toggle("off", paused);
  const wrap = document.createElement("span");
  wrap.className = "site-switch";
  wrap.append(
    buildSwitch(!paused, labelId, (on) => {
      row.classList.toggle("off", !on);
      if (on) {
        void (async () => {
          for (const h of hostnames) await setSiteDisabled(h, false);
          await render();
        })();
        return;
      }
      const input = wrap.querySelector<HTMLInputElement>("input")!;
      openPauseMenu(document, input.closest("label")!, pauseMenuLabels(name), (choice) => {
        if (choice === null) {
          input.checked = true;
          row.classList.remove("off");
          input.focus();
          return;
        }
        void (async () => {
          for (const h of hostnames) await setSiteDisabled(h, true, pauseEnd(choice, Date.now()), "sites");
          await render();
        })();
      });
    })
  );
  const until = paused ? pausedNote(settings, hostnames[0]!) : null;
  if (until) wrap.append(Object.assign(document.createElement("small"), { className: "row-note", textContent: until }));
  return wrap;
}

function buildSiteRow(settings: Settings, group: SiteGroup<TopSite>): HTMLElement {
  const name = siteName(group.site);
  const hostnames = group.members.map((m) => m.hostname);
  const item = document.createElement("div");
  item.className = "sr";
  item.dataset.open = "false";
  item.dataset.search = hostnames.join(" ");
  item.dataset.hosts = hostnames.join(" ");
  const head = document.createElement("div");
  head.className = "sr-head";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "sr-btn";
  open.setAttribute("aria-expanded", "false");
  const labelId = `site-row-${group.site}`;
  const text = document.createElement("span");
  text.className = "sr-text";
  const title = Object.assign(document.createElement("span"), { className: "sr-name", id: labelId, textContent: name });
  open.title = groupLabel(group);
  const kinds = addKinds(group.members);
  const sub = kindsLine(kinds) || (group.members.length > 1 ? tFallback("siteAddresses", `${group.members.length} addresses`, String(group.members.length)) : "");
  text.append(title);
  if (sub) text.append(Object.assign(document.createElement("small"), { className: "sr-sub", textContent: sub }));
  const total = Object.assign(document.createElement("span"), { className: "sr-total", textContent: group.count.toLocaleString() });
  open.append(siteIcon(group.members[0]!.hostname), text, total, Object.assign(document.createElement("span"), { className: "rr-chev" }));
  head.append(open, siteSwitch(settings, hostnames, labelId, name, item));

  const more = document.createElement("div");
  more.className = "rr-more";
  more.append(buildSitePanel(settings, group, kinds));
  open.addEventListener("click", () => {
    const show = item.dataset.open !== "true";
    item.dataset.open = String(show);
    open.setAttribute("aria-expanded", String(show));
  });
  item.append(head, more);
  return item;
}

/** A site's panel (Safari's Privacy Report opens a site the same way): the
 * week's blocks there by kind, the companies seen there (each opens on
 * Trackers), each address when there are several, and a way to report a
 * problem. */
function buildSitePanel(settings: Settings, group: SiteGroup<TopSite>, kinds: BlockKinds | null): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "rr-inner site-panel";

  if (kinds) {
    const tiles = document.createElement("div");
    tiles.className = "sp-tiles";
    for (const [label, count] of [
      [tFallback("ovKindAdsTitle", "Ads"), kinds.ads],
      [tFallback("ovKindTrackersTitle", "Trackers"), kinds.trackers],
      [tFallback("ovKindPopupsTitle", "Pop-ups"), kinds.popups],
    ] as const) {
      const tile = document.createElement("div");
      tile.className = "sp-tile";
      tile.append(Object.assign(document.createElement("b"), { textContent: count.toLocaleString() }), Object.assign(document.createElement("span"), { textContent: label }));
      tiles.append(tile);
    }
    panel.append(tiles);
  }

  const companies: string[] = [];
  for (const m of group.members) for (const c of m.companies ?? []) if (!companies.includes(c)) companies.push(c);
  panel.append(Object.assign(document.createElement("h4"), { className: "rr-label", textContent: tFallback("siteCompaniesSeen", "Tracker companies seen here") }));
  if (companies.length) {
    const list = document.createElement("ul");
    list.className = "rr-sites";
    for (const company of companies.slice(0, 10)) {
      const li = document.createElement("li");
      const b = Object.assign(document.createElement("button"), { type: "button", className: "rr-site" });
      const host = companyHostCache(company);
      b.append(host ? siteIcon(host) : buildSiteIcon(document, company, null), Object.assign(document.createElement("span"), { textContent: company }));
      b.title = tFallback("insOpenCompany", `See ${company} on Trackers`, company);
      b.addEventListener("click", () => openCompanyOnTrackers(company));
      li.append(b);
      list.append(li);
    }
    if (companies.length > 10) list.append(Object.assign(document.createElement("li"), { className: "rr-site-more", textContent: tFallback("siteCompaniesMore", `and ${companies.length - 10} more`, String(companies.length - 10)) }));
    panel.append(list);
  } else {
    panel.append(Object.assign(document.createElement("p"), { className: "sp-none", textContent: tFallback("siteNoCompanies", "None that Moat could name.") }));
  }

  if (group.members.length > 1) {
    panel.append(Object.assign(document.createElement("h4"), { className: "rr-label", textContent: tFallback("siteAddressesTitle", "Addresses on this site") }));
    const list = document.createElement("div");
    list.className = "sp-hosts";
    for (const m of group.members) {
      const row = document.createElement("div");
      row.className = "sp-host";
      const id = `site-host-${m.hostname}`;
      row.append(
        Object.assign(document.createElement("span"), { className: "sp-host-name", id, textContent: m.hostname.replace(/^www\./, "") }),
        Object.assign(document.createElement("span"), { className: "sp-host-n", textContent: m.count.toLocaleString() }),
        siteSwitch(settings, [m.hostname], id, m.hostname.replace(/^www\./, ""), row)
      );
      list.append(row);
    }
    panel.append(list);
  }

  const report = Object.assign(document.createElement("button"), { type: "button", className: "rr-learn sp-report", textContent: tFallback("siteReport", "Report a problem with this site") });
  report.addEventListener("click", () => {
    void browser.tabs.create({ url: browser.runtime.getURL(`report.html?${new URLSearchParams({ site: group.members[0]!.hostname })}`) });
  });
  panel.append(report);
  return panel;
}

/** Opens Sites at the row holding `hostname`, opened and in view. */
function openSiteOnSites(hostname: string): void {
  location.hash = "sites";
  requestAnimationFrame(() => {
    const row = [...document.querySelectorAll<HTMLElement>("#s-rows .sr")].find((r) => (r.dataset.hosts ?? "").split(" ").includes(hostname));
    if (!row) return;
    revealListRow(row);
    if (row.dataset.open !== "true") row.querySelector<HTMLButtonElement>(".sr-btn")?.click();
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.querySelector<HTMLButtonElement>(".sr-btn")?.focus({ preventScroll: true });
  });
}

/** Opens Trackers at `company`'s row, opened and in view. */
function openCompanyOnTrackers(company: string): void {
  location.hash = "trackers";
  requestAnimationFrame(() => {
    const row = [...document.querySelectorAll<HTMLElement>("#t-who .rr")].find((r) => r.dataset.company === company);
    if (!row) return;
    revealListRow(row);
    if (row.dataset.open !== "true") row.querySelector<HTMLButtonElement>(".rr-btn")?.click();
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.querySelector<HTMLButtonElement>(".rr-btn")?.focus({ preventScroll: true });
  });
}

/** A row past the first few of a long list is hidden until "Show all". */
function revealListRow(row: HTMLElement): void {
  if (!row.hidden) return;
  const more = row.parentElement?.closest(".site-box, .ins-list-box")?.nextElementSibling;
  more?.querySelector<HTMLButtonElement>("button")?.click();
}

// ---------- Security ----------

const SECURITY_GROUPS = ["phishing-urls", "scam", "malicious-urls", "badware"];
const IMPORT_UNDO_KEY = "importUndo";
/** How long "Undo" stays offered after restoring from a file. */
const IMPORT_UNDO_DAYS = 14;

interface ImportUndo {
  time: number;
  before: Partial<Settings>;
  risky: boolean;
}

async function getImportUndo(): Promise<ImportUndo | null> {
  const stored = (await browser.storage.local.get(IMPORT_UNDO_KEY))[IMPORT_UNDO_KEY] as ImportUndo | undefined;
  if (!stored || Date.now() - stored.time > IMPORT_UNDO_DAYS * 864e5) return null;
  return stored;
}

async function undoImport(): Promise<void> {
  const undo = await getImportUndo();
  if (!undo) return;
  await setSettings(undo.before);
  await browser.storage.local.remove(IMPORT_UNDO_KEY);
  savedToast.show(tFallback("importUndone", "Your settings are back to how they were before the restore."));
  await render();
}

function relativeTime(time: number): string {
  const minutes = Math.round((time - Date.now()) / 60_000);
  const rel = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rel.format(minutes, "minute");
  if (Math.abs(minutes) < 1440) return rel.format(Math.round(minutes / 60), "hour");
  return rel.format(Math.round(minutes / 1440), "day");
}

type CheckState = "ok" | "warn" | "info";

/** One Safety check row: a status mark, what's true, and the fix when there is one. */
function checkRow(state: CheckState, title: string, detail: string, action?: { label: string; run: () => void }): HTMLElement {
  const row = document.createElement("div");
  row.className = "check-row";
  row.dataset.state = state;
  const mark = document.createElement("span");
  mark.className = "check-mark";
  mark.setAttribute("aria-hidden", "true");
  const text = document.createElement("div");
  text.className = "check-text";
  text.append(Object.assign(document.createElement("b"), { textContent: title }), Object.assign(document.createElement("small"), { textContent: detail }));
  row.append(mark, text);
  if (action) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: state === "warn" ? "ab-btn primary" : "ab-btn", textContent: action.label });
    b.addEventListener("click", action.run);
    row.append(b);
  }
  return row;
}

async function renderSecurityPage(settings: Settings, usage: UsageSummaryResponse): Promise<void> {
  const [live, undo] = await Promise.all([getLiveUpdateStatus().catch(() => null), getImportUndo()]);
  const rows: HTMLElement[] = [];

  rows.push(
    settings.enabled
      ? checkRow("ok", tFallback("checkOnTitle", "Moat is on"), tFallback("checkOnDetail", "Pages are checked before they load."))
      : checkRow("warn", tFallback("checkOffTitle", "Moat is off"), tFallback("checkOffDetail", "Nothing is blocked, including dangerous sites."), {
          label: tFallback("checkTurnOn", "Turn on"),
          run: () => void setSettings({ enabled: true }).then(() => render()),
        })
  );

  const off = SECURITY_GROUPS.filter((g) => settings.filterGroups[g] === false);
  const names = off.map((g) => tFallback(LIST_LABELS[g]!.nameKey, LIST_LABELS[g]!.name));
  rows.push(
    off.length
      ? checkRow("warn", tFallback("checkListsOffTitle", `${names.join(", ")} off`, names.join(", ")), tFallback("checkListsOffDetail", "Moat won't stop these dangerous sites."), {
          label: tFallback("checkTurnOn", "Turn on"),
          run: () => void setSettings({ filterGroups: { ...settings.filterGroups, ...Object.fromEntries(off.map((g) => [g, true])) } }).then(() => render()),
        })
      : checkRow("ok", tFallback("checkListsOnTitle", "Dangerous-site lists are on"), tFallback("checkListsOnDetail", "Phishing, malware, scams and risky downloads."))
  );

  if (live) {
    rows.push(
      live.ok
        ? checkRow("ok", tFallback("checkUpdatedTitle", "Lists are up to date"), tFallback("ovListsUpdated", `Lists updated ${relativeTime(live.timestamp)}`, relativeTime(live.timestamp)))
        : checkRow("warn", tFallback("checkUpdateFailedTitle", "Lists couldn't update"), tFallback("checkUpdateFailedDetail", "Moat keeps using the lists it has and tries again soon."))
    );
  }

  rows.push(
    settings.leakedPasswordCheck
      ? checkRow("ok", tFallback("checkPwOnTitle", "Leaked password warnings are on"), tFallback("checkPwOnDetail", "Moat warns if a password you type was in a data breach."))
      : checkRow("info", tFallback("checkPwOffTitle", "Leaked password warnings are off"), tFallback("checkPwOffDetail", "Moat can warn when a password you type was in a data breach. Only a short code leaves your device."), {
          label: tFallback("checkTurnOn", "Turn on"),
          run: () => void setSettings({ leakedPasswordCheck: true }).then(() => render()),
        })
  );

  const paused = settings.disabledSites.length;
  if (paused) {
    rows.push(
      checkRow("info", (paused === 1 ? tFallback("checkPausedOne", "Paused on 1 site") : tFallback("checkPausedTitle", `Paused on ${paused} sites`, String(paused))), tFallback("checkPausedDetail", "Moat doesn't block ads or trackers there. Dangerous sites are still stopped."), {
        label: tFallback("checkReview", "Review"),
        run: () => (location.hash = "paused"),
      })
    );
  }
  const allowed = settings.customAllowedDomains.length;
  if (allowed) {
    rows.push(
      checkRow("info", (allowed === 1 ? tFallback("checkAllowedOne", "1 site in Never block") : tFallback("checkAllowedTitle", `${allowed} sites in Never block`, String(allowed))), tFallback("checkAllowedDetail", "Ads and trackers load there. Dangerous sites are still stopped."), {
        label: tFallback("checkReview", "Review"),
        run: () => (location.hash = "rules"),
      })
    );
  }
  if (undo) {
    const when = new Date(undo.time).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    rows.push(
      checkRow(undo.risky ? "warn" : "info", tFallback("checkRestoredTitle", `Settings restored from a file on ${when}`, when), undo.risky ? tFallback("checkRestoredRisky", "That file turned some protection off. Undo it if you didn't make it yourself.") : tFallback("checkRestoredDetail", "You can put your settings back to how they were."), {
        label: tFallback("checkUndo", "Undo restore"),
        run: () => void undoImport(),
      })
    );
  }

  const warnings = rows.filter((r) => r.dataset.state === "warn").length;
  setTakeaway("sec-check-take", [warnings ? (warnings === 1 ? tFallback("checkTakeWarnOne", "One thing needs a look.") : tFallback("checkTakeWarnMany", `${warnings} things need a look.`, String(warnings))) : tFallback("checkTakeOk", "Everything that keeps you safe is on.")]);
  document.getElementById("sec-check")?.replaceChildren(...rows);
  renderStops(usage.pageStops);
}

/** Pages Moat stopped: dangerous ones first, each saying what it was and
 * what to do; the rest folded into one line each. */
function renderStops(stops: UsageSummaryResponse["pageStops"]): void {
  const list = document.getElementById("sec-list");
  if (!list) return;
  const danger = stops.filter((s) => s.kind === "danger" || !s.kind || s.kind === "unknown");
  const ads = stops.filter((s) => s.kind === "ads");
  const custom = stops.filter((s) => s.kind === "custom" || s.kind === "policy");
  setTakeaway(
    "sec-stops-take",
    stops.length
      ? [danger.length ? { bold: (danger.length === 1 ? tFallback("secStopsDangerOne", "1 dangerous page") : tFallback("secStopsDangerMany", `${danger.length} dangerous pages`, String(danger.length))) } : "", danger.length ? ` ${(danger.length === 1 ? tFallback("secStopsDangerTailOne", "was stopped this week.") : tFallback("secStopsDangerTail", "were stopped this week."))}` : tFallback("secStopsNoDanger", "No dangerous pages this week.")]
      : [tFallback("insStopsEmpty", "Nothing stopped this week. Moat checks every page you open against its danger lists.")]
  );
  const parts: HTMLElement[] = [];
  if (danger.length) {
    const group = document.createElement("div");
    group.className = "stop-list-danger";
    for (const stop of danger) group.append(stopRow(stop, true));
    parts.push(group);
    if (danger.some((s) => s.list === "phishing-urls" || s.list === "scam")) {
      parts.push(Object.assign(document.createElement("p"), { className: "stop-tip", textContent: tFallback("secPhishTip", "If you typed a password or card number on one of these pages before Moat stopped it, change that password and tell your bank.") }));
    }
  }
  for (const [items, summary] of [
    [ads, (ads.length === 1 ? tFallback("secAdPagesOne", "1 ad or tracker page never loaded") : tFallback("secAdPagesMany", `${ads.length} ad and tracker pages never loaded`, String(ads.length)))],
    [custom, (custom.length === 1 ? tFallback("secCustomOne", "1 page on a block list you or your organization set") : tFallback("secCustomMany", `${custom.length} pages on block lists you or your organization set`, String(custom.length)))],
  ] as const) {
    if (!items.length) continue;
    const details = document.createElement("details");
    details.className = "stop-fold";
    details.append(Object.assign(document.createElement("summary"), { textContent: summary }));
    for (const stop of items) details.append(stopRow(stop, false));
    parts.push(details);
  }
  list.replaceChildren(...parts);
}

/** What a stopped page was, in a few words. */
function stopWhy(stop: UsageSummaryResponse["pageStops"][number]): string {
  if (stop.list === "custom") return tFallback("blockedListCustom", "Your block list");
  if (stop.list === "policy") return tFallback("blockedListPolicy", "Your organization's policy");
  const label = stop.list ? LIST_LABELS[stop.list] : undefined;
  if (!label) return tFallback("secStopUnknown", "On a danger list Moat couldn't name");
  return stop.kind === "danger" ? `${tFallback(label.nameKey, label.name)}: ${tFallback(label.descKey, label.desc).replace(/\.$/, "").toLowerCase()}` : tFallback(label.nameKey, label.name);
}

/** A stopped page never loaded, so the browser has no icon for it: a tile
 * that says what kind of page it was, red for a dangerous one. */
function stopIcon(stop: UsageSummaryResponse["pageStops"][number]): HTMLElement {
  const glyph = stopGlyph(stop.list, stop.kind);
  return buildGlyphTile(document, glyph, glyph === "blocked" ? "glyph-tile" : "glyph-tile tile-danger");
}

function stopRow(stop: UsageSummaryResponse["pageStops"][number], loud: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = loud ? "stop-row loud" : "stop-row";
  const text = document.createElement("div");
  text.className = "stop-text";
  text.append(Object.assign(document.createElement("b"), { textContent: stop.hostname }), Object.assign(document.createElement("small"), { textContent: `${stopWhy(stop)} · ${relativeTime(stop.time)}` }));
  row.append(stopIcon(stop), text);
  // A safe page on a danger list can't be allowed from here (the security
  // lists outrank "Never block", see rulePriorities.ts), so the fix is to
  // tell the developer. Your own list and your organization's aren't
  // Moat's to correct.
  if (stop.kind !== "custom" && stop.kind !== "policy") {
    const report = Object.assign(document.createElement("button"), { type: "button", className: "rr-learn stop-report", textContent: loud ? tFallback("secNotDangerous", "Not dangerous?") : tFallback("insReportMistake", "Report a mistake") });
    report.setAttribute("aria-label", tFallback("insReportMistakeFor", `Report a mistake: ${stop.hostname}`, stop.hostname));
    report.addEventListener("click", () => {
      const params = new URLSearchParams({ site: stop.hostname, reason: "false-alarm" });
      void browser.tabs.create({ url: browser.runtime.getURL(`report.html?${params}`) });
    });
    row.append(report);
  }
  return row;
}


// ---------- Review your protection (checkup.ts) ----------

const LEVEL_DESC: Record<Level, [string, string]> = {
  lite: ["levelLightDesc", "Blocks ads, pop-ups, and dangerous sites like scams and malware. Trackers still load, so sites that depend on them keep working."],
  standard: ["levelBalancedDesc", "Everything in Light, plus trackers, tracking added to links, and fake login sites. Recommended."],
  strict: ["levelStrictDesc", "Everything in Balanced, plus cookie banners and social media buttons. It also makes your device harder for sites to recognize and keeps your IP address private in video calls. A few sites may break."],
};
const CHECKUP_PRIVACY = ["cookies", "webrtc"];
const CHECKUP_ANNOYANCES = ["consentReject", "grayscale", "feedScan", "searchSlop"];

document.getElementById("checkup-start")?.addEventListener("click", () => {
  void getEffectiveSettings().then((settings) => {
    const preset = detectPreset(settings);
    const asSwitch = (id: string) => {
      const def = PROTECTIONS.find((p) => p.id === id)!;
      return { key: def.settingKey, title: tFallback(...def.titleKey), desc: tFallback(...def.descKey) };
    };
    openCheckup(document, {
      t: tFallback,
      settings,
      // A customized level counts as the level it was changed from.
      currentLevel: (LEVELS as readonly string[]).includes(preset) ? (preset as Level) : preset === "custom" ? (presetDifference(settings).base as Level) : null,
      levelPatch: (level) => presetPatch(level),
      levelName: (level) => levelLabel(level),
      levelDesc: (level) => tFallback(...LEVEL_DESC[level]),
      privacy: CHECKUP_PRIVACY.map(asSwitch),
      annoyances: CHECKUP_ANNOYANCES.map(asSwitch),
      apply: (patch, before) => {
        void setSettings(patch).then(() => {
          void render();
          savedToast.offerUndo(tFallback("checkupApplied", "Protection updated. It applies to pages you open or reload."), tFallback("toastUndo", "Undo"), () => {
            void setSettings(before).then(() => render());
          });
        });
      },
    });
  });
});

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
// What the import would overwrite, kept so it can be undone (Backup and
// Security both offer Undo for IMPORT_UNDO_DAYS).
let pendingImportUndo: ImportUndo | null = null;

function resetImportConfirm(): void {
  pendingImportPayload = null;
  pendingImportUndo = null;
  importSettingsConfirm.hidden = true;
  importSettingsSummary.replaceChildren();
  importSettingsRisks.hidden = true;
  importSettingsRiskList.replaceChildren();
}

// Names a few sites, then says how many more.
function hostList(hosts: readonly string[]): string {
  const shown = hosts.slice(0, 3).join(", ");
  return hosts.length > 3 ? tFallback("optionsImportRiskMore", `${shown} and ${hosts.length - 3} more`, [shown, String(hosts.length - 3)]) : shown;
}

function addImportRisk(key: string, fallback: string, substitutions?: string): void {
  const item = document.createElement("li");
  item.textContent = tFallback(key, fallback, substitutions);
  importSettingsRiskList.append(item);
  importSettingsRisks.hidden = false;
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
    // Anything that weakens protection is named before the summary.
    const risks = importRisks(current, patch);
    if (risks.turnsOff) addImportRisk("optionsImportRiskOff", "Turns Moat off.");
    if (risks.dangerListsOff.length) {
      const names = risks.dangerListsOff.map((g) => tFallback(LIST_LABELS[g]?.nameKey ?? "", LIST_LABELS[g]?.name ?? g)).join(", ");
      addImportRisk("optionsImportRiskDanger", `Stops blocking dangerous sites: ${names}.`, names);
    }
    if (risks.neverBlock.length) {
      const sites = hostList(risks.neverBlock);
      addImportRisk("optionsImportRiskNeverBlock", `Lets ads and trackers through on ${sites}.`, sites);
    }
    if (risks.paused.length) {
      const sites = hostList(risks.paused);
      addImportRisk("optionsImportRiskPaused", `Pauses Moat on ${sites}.`, sites);
    }
    const before = Object.fromEntries(Object.keys(patch).map((key) => [key, current[key as keyof Settings]])) as Partial<Settings>;
    const risky = risks.turnsOff || risks.dangerListsOff.length > 0 || risks.neverBlock.length > 0 || risks.paused.length > 0;
    pendingImportUndo = { time: 0, before, risky };
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
  const undo = pendingImportUndo;
  const result = (await browser.runtime.sendMessage(message)) as ImportSettingsResponse;
  if (result.ok && undo) await browser.storage.local.set({ [IMPORT_UNDO_KEY]: { ...undo, time: Date.now() } });
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

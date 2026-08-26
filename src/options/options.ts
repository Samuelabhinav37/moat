import browser from "webextension-polyfill";
import {
  getEffectiveSettings,
  getSettings,
  removeCustomCosmeticRule,
  removeGrayscaleRule,
  setSettings,
  setSiteDisabled,
} from "../background/settings";
import { getManagedPolicy, isLocked } from "../background/managedPolicy";
import { getLiveUpdateStatus } from "../background/liveUpdates";
import { getFilterGroupStatus } from "../background/filterGroups";
import { isSupported as isCnameUncloakSupported } from "../background/cnameUncloak";
import { detectPreset, presetPatch, type PresetName } from "./filterPresets";
import { summarizeFilterLists, type RulesetManifestEntry } from "../shared/rulesetManifest";
import type {
  ExportSettingsMessage,
  ImportSettingsMessage,
  ImportSettingsResponse,
  Settings,
} from "../types";

// ---------- Tabs ----------

const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tab-button");
const tabPanels = document.querySelectorAll<HTMLElement>("[data-tab-panel]");

function selectTab(name: string): void {
  for (const button of tabButtons) button.setAttribute("aria-selected", String(button.dataset.tab === name));
  for (const panel of tabPanels) panel.hidden = panel.dataset.tabPanel !== name;
}

for (const button of tabButtons) {
  button.addEventListener("click", () => selectTab(button.dataset.tab!));
}

// ---------- Protection tab ----------

const masterToggle = document.getElementById("master-toggle") as HTMLInputElement;
const protectionLockedBadge = document.getElementById("protection-locked-badge") as HTMLElement;
const cookiesToggle = document.getElementById("cookies-toggle") as HTMLInputElement;
const webrtcToggle = document.getElementById("webrtc-toggle") as HTMLInputElement;
const fingerprintToggle = document.getElementById("fingerprint-toggle") as HTMLInputElement;
const grayscaleToggle = document.getElementById("grayscale-toggle") as HTMLInputElement;
const feedScanToggle = document.getElementById("feed-scan-toggle") as HTMLInputElement;
const consentRejectToggle = document.getElementById("consent-reject-toggle") as HTMLInputElement;
const cnameUncloakToggle = document.getElementById("cname-uncloak-toggle") as HTMLInputElement;
const syncToggle = document.getElementById("sync-toggle") as HTMLInputElement;
const cnameUnsupportedHint = document.getElementById("cname-unsupported-hint") as HTMLElement;
const liveStatus = document.getElementById("live-status") as HTMLElement;
const siteList = document.getElementById("site-list") as HTMLUListElement;
const siteEmptyState = document.getElementById("site-empty-state") as HTMLElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const addButton = document.getElementById("add-button") as HTMLButtonElement;

function renderLiveStatus(status: Awaited<ReturnType<typeof getLiveUpdateStatus>>): void {
  if (!status) {
    liveStatus.textContent = "Not checked yet.";
    return;
  }
  const when = new Date(status.timestamp).toLocaleString();
  liveStatus.textContent = status.ok
    ? `Last updated ${when} — ${status.domainCount} domains.`
    : `Last attempt failed (${when}) — using the bundled baseline until the next try.`;
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

// ---------- Filter Lists tab ----------

const presetRow = document.getElementById("preset-row") as HTMLElement;
const presetHint = document.getElementById("preset-hint") as HTMLElement;
const filtersLockedBadge = document.getElementById("filters-locked-badge") as HTMLElement;
const filterListRows = document.getElementById("filter-list-rows") as HTMLElement;
const filterBudgetWarning = document.getElementById("filter-budget-warning") as HTMLElement;

const PRESET_HINTS: Record<PresetName | "custom", string> = {
  off: "Nothing is blocked.",
  essential: "Ads, popups, and known-malicious sites only.",
  standard: "Standard level blocks ads, trackers, and known malicious sites.",
  strict: "Everything, plus the browser-wide privacy toggles above.",
  custom: "A mix you've put together yourself.",
};

const CATEGORY_LABELS: Record<RulesetManifestEntry["category"], string> = {
  ads: "Ads & trackers",
  security: "Security",
  annoyance: "Annoyances",
  core: "Core",
};

let manifestCache: RulesetManifestEntry[] | null = null;

/** Updated synchronously (before any await) on every checkbox change below,
 * so two filter-list toggles fired in quick succession each merge onto the
 * other's already-applied change instead of racing two independent
 * getSettings() reads and clobbering one write with the other. */
let currentFilterGroups: Settings["filterGroups"] | null = null;

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

async function renderFilterLists(settings: Settings): Promise<void> {
  const manifest = await loadRulesetManifest();
  if (!manifest) {
    presetHint.textContent = "Couldn't load filter lists.";
    const error = document.createElement("p");
    error.className = "empty-state";
    error.textContent = "Couldn't load filter lists.";
    filterListRows.replaceChildren(error);
    return;
  }
  const lists = summarizeFilterLists(manifest);
  currentFilterGroups = settings.filterGroups;

  const preset = detectPreset(settings);
  presetHint.textContent = PRESET_HINTS[preset];
  for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
  }

  filterListRows.replaceChildren();
  let lastCategory = "";
  for (const list of lists.sort((a, b) => a.category.localeCompare(b.category))) {
    if (list.category !== lastCategory) {
      const heading = document.createElement("div");
      heading.className = "filter-category";
      heading.textContent = CATEGORY_LABELS[list.category];
      filterListRows.append(heading);
      lastCategory = list.category;
    }

    const row = document.createElement("div");
    row.className = "row filter-row";

    const label = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.id = `filter-list-${list.group}-label`;
    name.textContent = list.name;
    const count = document.createElement("div");
    count.className = "count";
    count.textContent = `${list.ruleCount.toLocaleString()} rules`;
    label.append(name, count);

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("aria-labelledby", name.id);
    input.checked = settings.filterGroups[list.group] ?? true;
    const track = document.createElement("span");
    track.className = "track";
    track.innerHTML = '<span class="thumb"></span>';
    toggle.append(input, track);

    input.addEventListener("change", async () => {
      const updated = { ...(currentFilterGroups ?? settings.filterGroups), [list.group]: input.checked };
      currentFilterGroups = updated;
      await setSettings({ filterGroups: updated });
      await render();
    });

    row.append(label, toggle);
    filterListRows.append(row);
  }
}

for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", async () => {
    await setSettings(presetPatch(button.dataset.preset as PresetName));
    await render();
  });
}

// ---------- Custom Rules tab ----------

const customBlockList = document.getElementById("custom-block-list") as HTMLUListElement;
const customBlockEmpty = document.getElementById("custom-block-empty") as HTMLElement;
const customBlockInput = document.getElementById("custom-block-input") as HTMLInputElement;
const customBlockAdd = document.getElementById("custom-block-add") as HTMLButtonElement;

const customAllowList = document.getElementById("custom-allow-list") as HTMLUListElement;
const customAllowEmpty = document.getElementById("custom-allow-empty") as HTMLElement;
const customAllowInput = document.getElementById("custom-allow-input") as HTMLInputElement;
const customAllowAdd = document.getElementById("custom-allow-add") as HTMLButtonElement;

async function addCustomDomain(field: "customBlockedDomains" | "customAllowedDomains", input: HTMLInputElement): Promise<void> {
  const hostname = normalizeHostname(input.value);
  if (!hostname) return;
  const settings = await getSettings();
  const set = new Set(settings[field]);
  set.add(hostname);
  await setSettings({ [field]: [...set] });
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

const hiddenElementList = document.getElementById("hidden-element-list") as HTMLUListElement;
const hiddenElementEmpty = document.getElementById("hidden-element-empty") as HTMLElement;
const grayscaleElementList = document.getElementById("grayscale-element-list") as HTMLUListElement;
const grayscaleElementEmpty = document.getElementById("grayscale-element-empty") as HTMLElement;

/** Shared by the picker's "Hide" and "Gray out" saved-rule lists -- both are
 * hostname -> selector[] maps rendered the same way. */
function renderSelectorRules(
  list: HTMLUListElement,
  emptyState: HTMLElement,
  rules: Record<string, string[]>,
  onRemove: (hostname: string, selector: string) => Promise<unknown>,
  rerenderSelf: () => Promise<void>
): void {
  const rows = Object.entries(rules)
    .flatMap(([hostname, selectors]) => selectors.map((selector) => ({ hostname, selector })))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));

  renderRows(
    list,
    emptyState,
    rows,
    (row) => `${row.hostname} — ${row.selector}`,
    "Remove",
    (row) => onRemove(row.hostname, row.selector),
    rerenderSelf
  );
}

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
    "Resume",
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
    "Remove",
    async (domain) => {
      const current = await getSettings();
      await setSettings({ customBlockedDomains: current.customBlockedDomains.filter((d) => d !== domain) });
    },
    rerenderCustomBlockList
  );
}

async function rerenderCustomAllowList(): Promise<void> {
  const settings = await getEffectiveSettings();
  renderDomainList(
    customAllowList,
    customAllowEmpty,
    settings.customAllowedDomains,
    "Remove",
    async (domain) => {
      const current = await getSettings();
      await setSettings({ customAllowedDomains: current.customAllowedDomains.filter((d) => d !== domain) });
    },
    rerenderCustomAllowList
  );
}

async function rerenderHiddenElementList(): Promise<void> {
  const settings = await getEffectiveSettings();
  renderSelectorRules(
    hiddenElementList,
    hiddenElementEmpty,
    settings.customCosmeticRules,
    removeCustomCosmeticRule,
    rerenderHiddenElementList
  );
}

async function rerenderGrayscaleElementList(): Promise<void> {
  const settings = await getEffectiveSettings();
  renderSelectorRules(
    grayscaleElementList,
    grayscaleElementEmpty,
    settings.customGrayscaleRules,
    removeGrayscaleRule,
    rerenderGrayscaleElementList
  );
}

async function render(): Promise<void> {
  const [settings, policy] = await Promise.all([getEffectiveSettings(), getManagedPolicy()]);

  const protectionLocked = isLocked("protection", policy);
  masterToggle.checked = settings.enabled;
  masterToggle.disabled = protectionLocked;
  protectionLockedBadge.hidden = !protectionLocked;

  cookiesToggle.checked = settings.blockThirdPartyCookies;
  webrtcToggle.checked = settings.webrtcLeakProtection;
  fingerprintToggle.checked = settings.fingerprintResistance;
  grayscaleToggle.checked = settings.grayscaleUnblockableAds;
  feedScanToggle.checked = settings.aggressiveFeedAdRemoval;
  consentRejectToggle.checked = settings.cookieBannerAutoReject;

  const cnameSupported = isCnameUncloakSupported();
  cnameUncloakToggle.checked = settings.cnameUncloaking;
  cnameUncloakToggle.disabled = !cnameSupported;
  cnameUnsupportedHint.hidden = cnameSupported;

  syncToggle.checked = settings.syncEnabled;

  renderLiveStatus(await getLiveUpdateStatus());

  renderDomainList(
    siteList,
    siteEmptyState,
    settings.disabledSites,
    "Resume",
    (hostname) => setSiteDisabled(hostname, false).then(() => undefined),
    rerenderSiteList
  );

  const filterGroupStatus = await getFilterGroupStatus();
  filterBudgetWarning.hidden = filterGroupStatus === null || filterGroupStatus.ok;

  const filtersLocked = isLocked("filterGroups", policy);
  filtersLockedBadge.hidden = !filtersLocked;
  for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) button.disabled = filtersLocked;
  await renderFilterLists(settings);
  for (const input of filterListRows.querySelectorAll("input")) input.disabled = filtersLocked;

  renderDomainList(
    customBlockList,
    customBlockEmpty,
    settings.customBlockedDomains,
    "Remove",
    async (domain) => {
      const current = await getSettings();
      await setSettings({ customBlockedDomains: current.customBlockedDomains.filter((d) => d !== domain) });
    },
    rerenderCustomBlockList
  );
  renderDomainList(
    customAllowList,
    customAllowEmpty,
    settings.customAllowedDomains,
    "Remove",
    async (domain) => {
      const current = await getSettings();
      await setSettings({ customAllowedDomains: current.customAllowedDomains.filter((d) => d !== domain) });
    },
    rerenderCustomAllowList
  );
  renderSelectorRules(
    hiddenElementList,
    hiddenElementEmpty,
    settings.customCosmeticRules,
    removeCustomCosmeticRule,
    rerenderHiddenElementList
  );
  renderSelectorRules(
    grayscaleElementList,
    grayscaleElementEmpty,
    settings.customGrayscaleRules,
    removeGrayscaleRule,
    rerenderGrayscaleElementList
  );

  versionText.textContent = `v${browser.runtime.getManifest().version}`;
  managedNotice.hidden = Object.keys(policy).length === 0;
}

masterToggle.addEventListener("change", async () => {
  await setSettings({ enabled: masterToggle.checked });
  await render();
});

cookiesToggle.addEventListener("change", async () => {
  await setSettings({ blockThirdPartyCookies: cookiesToggle.checked });
});

webrtcToggle.addEventListener("change", async () => {
  await setSettings({ webrtcLeakProtection: webrtcToggle.checked });
});

fingerprintToggle.addEventListener("change", async () => {
  await setSettings({ fingerprintResistance: fingerprintToggle.checked });
});

grayscaleToggle.addEventListener("change", async () => {
  await setSettings({ grayscaleUnblockableAds: grayscaleToggle.checked });
});

feedScanToggle.addEventListener("change", async () => {
  await setSettings({ aggressiveFeedAdRemoval: feedScanToggle.checked });
});

consentRejectToggle.addEventListener("change", async () => {
  await setSettings({ cookieBannerAutoReject: consentRejectToggle.checked });
});

cnameUncloakToggle.addEventListener("change", async () => {
  await setSettings({ cnameUncloaking: cnameUncloakToggle.checked });
});

syncToggle.addEventListener("change", async () => {
  await setSettings({ syncEnabled: syncToggle.checked });
});

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

importSettingsInput.addEventListener("change", async () => {
  const file = importSettingsInput.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const message: ImportSettingsMessage = { type: "import-settings", payload };
    const result = (await browser.runtime.sendMessage(message)) as ImportSettingsResponse;
    importSettingsStatus.hidden = false;
    importSettingsStatus.textContent = result.ok
      ? "Settings imported."
      : "That file doesn't look like a valid Moat settings export.";
    if (result.ok) await render();
  } catch {
    importSettingsStatus.hidden = false;
    importSettingsStatus.textContent = "Couldn't read that file.";
  } finally {
    importSettingsInput.value = "";
  }
});

void render();
